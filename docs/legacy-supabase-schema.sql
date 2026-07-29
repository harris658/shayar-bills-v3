-- Historical. The app moved to a Google Sheets backend on 2026-07-29; see
-- docs/superpowers/specs/2026-07-29-shayar-bills-v3-sheets-backend-design.md
-- (in the Haru Cowork OS repo). Kept as a record of the original data shape.

create table parties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table bills (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties(id),
  type text not null check (type in ('paid','received')),
  amount numeric not null check (amount > 0),
  bill_date date not null,
  note text not null default '',
  amount_expr text not null default '',
  status text not null default 'pending' check (status in ('pending','paid')),
  payment_ref text not null default '',
  payment_date date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table bank_txns (
  id uuid primary key default gen_random_uuid(),
  txn_date date not null,
  amount numeric not null,
  ref text not null,
  description text not null default '',
  matched_bill_id uuid references bills(id),
  imported_at timestamptz not null default now(),
  unique (ref, amount, txn_date)
);

alter table parties enable row level security;
alter table bills enable row level security;
alter table bank_txns enable row level security;

create policy "auth full access" on parties  for all to authenticated using (true) with check (true);
create policy "auth full access" on bills    for all to authenticated using (true) with check (true);
create policy "auth full access" on bank_txns for all to authenticated using (true) with check (true);
