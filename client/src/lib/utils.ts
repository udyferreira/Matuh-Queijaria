import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function parseDateOnly(isoValue: string | Date | null | undefined): string {
  if (!isoValue) return "";
  const str = typeof isoValue === "string" ? isoValue : isoValue.toISOString();
  const datePart = str.split("T")[0];
  const [yr, mo, dy] = datePart.split("-");
  if (!yr || !mo || !dy) return str;
  return `${dy}/${mo}/${yr}`;
}
