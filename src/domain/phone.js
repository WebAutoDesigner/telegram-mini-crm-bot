export function normalizePhone(input) {
  const digits = String(input ?? "").replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (digits.length === 11 && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }

  if (digits.length === 11 && digits.startsWith("7")) {
    return digits;
  }

  if (digits.length === 10) {
    return `7${digits}`;
  }

  return digits;
}

export function formatPhone(input) {
  const normalized = normalizePhone(input);
  if (!normalized) {
    return "";
  }

  if (normalized.length === 11 && normalized.startsWith("7")) {
    return `+7 (${normalized.slice(1, 4)}) ${normalized.slice(4, 7)}-${normalized.slice(
      7,
      9
    )}-${normalized.slice(9, 11)}`;
  }

  if (normalized.startsWith("7")) {
    return `+${normalized}`;
  }

  return `+${normalized}`;
}

export function formatWhatsAppPhone(input) {
  const normalized = normalizePhone(input);
  return normalized ? normalized.replace(/^\+/, "") : null;
}
