export function formatExactDecimal(value: string | null | undefined) {
  if (!value) return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign, integer, fraction] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

export function formatExactMoney(
  value: string | null | undefined,
  currency: string,
) {
  const amount = formatExactDecimal(value);
  return amount === "—" ? amount : `${currency || "MXN"} ${amount}`;
}
