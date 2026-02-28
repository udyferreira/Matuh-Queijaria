import { db } from "./db";
import { users, type User } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  return user;
}

export async function createUser(username: string, password: string, name: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({
    username,
    passwordHash,
    name,
    role: "admin",
  }).returning();
  return user;
}

export async function getAllUsers(): Promise<Omit<User, "passwordHash">[]> {
  const allUsers = await db.select({
    id: users.id,
    username: users.username,
    name: users.name,
    role: users.role,
    createdAt: users.createdAt,
  }).from(users);
  return allUsers;
}

export async function deleteUser(id: number): Promise<boolean> {
  const result = await db.delete(users).where(eq(users.id, id));
  return (result as any).rowCount > 0;
}

export async function seedDefaultAdmin(): Promise<void> {
  const existing = await db.select().from(users);
  if (existing.length === 0) {
    await createUser("matuh", "M@tuh!", "Administrador");
    console.log("[auth] Default admin user 'matuh' created");
  }
}
