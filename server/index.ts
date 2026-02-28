import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { logWebRequest } from "./logService";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { seedDefaultAdmin } from "./auth";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: number;
    username: string;
  }
}

app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? (() => { throw new Error("SESSION_SECRET is required in production"); })() : "dev-secret-change-me"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

const alexaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests" },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many AI requests" },
});

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts" },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests" },
});

app.use("/api/alexa/webhook", alexaLimiter);
app.use("/api/conversations", aiLimiter);
app.use("/api/auth/login", loginLimiter);

app.use("/api/auth", (req, res, next) => next());
app.use("/api/alexa/webhook", (req, res, next) => next());

const PUBLIC_PATHS = ["/api/auth/login", "/api/auth/me", "/api/alexa/webhook", "/api/auth/logout"];

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const path = req.path;
  const fullPath = `/api${path}`;

  if (PUBLIC_PATHS.some(p => fullPath.startsWith(p))) {
    return next();
  }

  if (!req.session?.userId) {
    return res.status(401).json({ message: "Não autenticado" });
  }

  next();
});

app.use("/api", generalLimiter);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

const POLLING_PATHS = [
  "/api/batches",
  "/api/batch/",
];

function isPollingRequest(method: string, path: string): boolean {
  if (method !== "GET") return false;
  return POLLING_PATHS.some(p => path === p || path.startsWith(p));
}

const SENSITIVE_KEYS = ["password", "passwordHash", "password_hash", "secret", "token", "authorization", "cookie"];

function sanitizeBody(body: any): any {
  if (!body || typeof body !== "object") return body;
  const sanitized = { ...body };
  for (const key of Object.keys(sanitized)) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    }
  }
  return sanitized;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);

      if (!isPollingRequest(req.method, path) && path !== "/api/alexa/webhook") {
        logWebRequest({
          method: req.method,
          path,
          statusCode: res.statusCode,
          durationMs: duration,
          requestBody: req.body && Object.keys(req.body).length > 0 ? sanitizeBody(req.body) : undefined,
          responseBody: capturedJsonResponse,
        });
      }
    }
  });

  next();
});

(async () => {
  await seedDefaultAdmin();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = process.env.NODE_ENV === "production"
      ? "Erro interno do servidor"
      : (err.message || "Internal Server Error");

    res.status(status).json({ message });
    console.error(`[error] ${err.message || err}`, err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : '');
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
