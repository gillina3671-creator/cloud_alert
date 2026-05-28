export type DaybookCompanyScope = {
  id: string;
  Guid: string | null;
  company_name: string | null;
};

export type DaybookRow = {
  id: string | number | null;
  company_id: string | null;
  company_name: string | null;
  transaction_date: string;
  transaction_type: string | null;
  voucher_type: string | null;
  voucher_number: string | null;
  reference_number: string | null;
  customer_name: string | null;
  ledger_name: string | null;
  amount: string | number | null;
  tax_amount: string | number | null;
  discount_amount: string | number | null;
  net_amount: string | number | null;
  payment_status: string | null;
  narration: string | null;
  remarks: string | null;
};

type RawDaybookRow = Record<string, string | number | null>;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function norm(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatAmount(value: string | number | null | undefined): string {
  return numberValue(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function businessDate(offsetDays = 0): string {
  const timeZone = process.env.BUSINESS_TIME_ZONE || "Asia/Kolkata";
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value || "1970";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

export async function getCompanyScope(companyId: string): Promise<DaybookCompanyScope | null> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  for (const column of ["id", "Guid"]) {
    const query = new URL(`${url}/rest/v1/tally_companies`);
    query.searchParams.set("select", "id,Guid,company_name");
    query.searchParams.set(column, `eq.${companyId}`);
    query.searchParams.set("limit", "1");
    const res = await fetch(query.toString(), { headers, cache: "no-store" });
    if (!res.ok) continue;
    const rows = (await res.json()) as DaybookCompanyScope[];
    if (rows[0]?.id) return rows[0];
  }

  return null;
}

function mapDaybookRow(row: RawDaybookRow): DaybookRow {
  return {
    id: row.id ?? null,
    company_id: (row.company_id as string | null) ?? null,
    company_name: (row.company_name as string | null) ?? null,
    transaction_date: String(row.transaction_date || row.date || row.voucher_date || ""),
    transaction_type: (row.transaction_type || row.type || null) as string | null,
    voucher_type: (row.voucher_type || row.transaction_type || row.type || null) as string | null,
    voucher_number: (row.voucher_number || row.voucher_no || row.invoicenumber || null) as string | null,
    reference_number: (row.reference_number || null) as string | null,
    customer_name: (row.customer_name || row.party_name || null) as string | null,
    ledger_name: (row.ledger_name || row.ledger || null) as string | null,
    amount: row.amount ?? row.total_amount ?? row.value ?? null,
    tax_amount: row.tax_amount ?? null,
    discount_amount: row.discount_amount ?? null,
    net_amount: row.net_amount ?? row.amount ?? row.total_amount ?? row.value ?? null,
    payment_status: (row.payment_status || null) as string | null,
    narration: (row.narration || row.description || null) as string | null,
    remarks: (row.remarks || null) as string | null,
  };
}

function belongsToCompany(row: DaybookRow, scope: DaybookCompanyScope): boolean {
  if (row.company_id && row.company_id === scope.id) return true;
  if (row.company_id && scope.Guid && row.company_id === scope.Guid) return true;
  if (!row.company_id && scope.company_name && norm(row.company_name) === norm(scope.company_name)) return true;
  if (row.company_name && scope.company_name && norm(row.company_name) === norm(scope.company_name)) return true;
  return false;
}

export async function getDaybookRows(scope: DaybookCompanyScope, date = businessDate()): Promise<DaybookRow[]> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const table = process.env.DAYBOOK_TABLE || "transactions";
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const select =
    "id,company_id,company_name,customer_name,transaction_type,voucher_type,voucher_number,reference_number,amount,tax_amount,discount_amount,net_amount,transaction_date,payment_status,narration,remarks";

  const companyCandidates = [scope.id, scope.Guid].filter(Boolean) as string[];
  for (const companyId of companyCandidates) {
    const query = new URL(`${url}/rest/v1/${table}`);
    query.searchParams.set("select", select);
    query.searchParams.set("company_id", `eq.${companyId}`);
    query.searchParams.set("transaction_date", `eq.${date}`);
    query.searchParams.set("order", "transaction_date.asc,voucher_type.asc");
    query.searchParams.set("limit", "20000");
    const res = await fetch(query.toString(), { headers, cache: "no-store" });
    if (!res.ok) continue;
    const rows = ((await res.json()) as RawDaybookRow[]).map(mapDaybookRow);
    if (rows.length) return rows;
  }

  if (!scope.company_name) return [];

  const all = new URL(`${url}/rest/v1/${table}`);
  all.searchParams.set("select", select);
  all.searchParams.set("transaction_date", `eq.${date}`);
  all.searchParams.set("order", "transaction_date.asc,voucher_type.asc");
  all.searchParams.set("limit", "20000");
  const allRes = await fetch(all.toString(), { headers, cache: "no-store" });
  if (!allRes.ok) return [];
  return ((await allRes.json()) as RawDaybookRow[]).map(mapDaybookRow).filter((row) => belongsToCompany(row, scope));
}
