import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let db;
let backfill;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid;
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    $$;
    grant usage on schema auth, public to anon, authenticated;
    create table public.lists(id text primary key, name text not null, color text not null default '#000', tape text not null default '#fff', sort_order integer not null default 0);
    create table public.tasks(id bigint generated always as identity primary key, list_id text not null references public.lists(id) on delete cascade, text text not null, done boolean not null default false, recur text, streak integer not null default 0, created_at timestamptz not null default now());
    alter table public.lists enable row level security;
    alter table public.tasks enable row level security;
    create policy "Allow all on lists" on public.lists for all using (true) with check (true);
    create policy "Allow all on tasks" on public.tasks for all using (true) with check (true);
    grant all on public.lists, public.tasks to anon, authenticated;
    grant all on sequence public.tasks_id_seq to anon, authenticated;
    insert into auth.users values ('${owner}', 'owner@example.test', now(), false), ('${other}', 'other@example.test', now(), false);
    insert into public.lists(id,name) values ('legacy','Existing list');
    insert into public.tasks(list_id,text) values ('legacy','Existing task');
  `);
  const migration = await readFile(new URL('../supabase/migrations/20260917053518_private_task_ownership.sql', import.meta.url), 'utf8');
  backfill = await readFile(new URL('../scripts/assign-owner.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(`insert into public.lists(id,name,owner_id) values ('owner','Owner list','${owner}'),('other','Other list','${other}');
    insert into public.tasks(list_id,text) values ('owner','Owner task'),('other','Other task');`);
}, 30000);

afterAll(async () => { await db?.close(); });

async function asUser(id, callback, anonymous = false) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, is_anonymous: anonymous })]);
    await db.exec(`set local role ${id ? 'authenticated' : 'anon'}`);
    return await callback();
  } finally { await db.exec('rollback'); }
}

describe('database ownership policies', () => {
  it.each(['select * from public.tasks', "insert into public.tasks(list_id,text) values ('owner','bad')", "update public.tasks set done=true", 'delete from public.tasks', 'select * from public.lists', "insert into public.lists(id,name) values ('bad','bad')", "update public.lists set name='bad'", 'delete from public.lists'])(
    'denies signed-out access: %s', async (sql) => {
      await expect(asUser(null, () => db.query(sql))).rejects.toThrow(/permission denied/);
    });

  it('restricts reads to the current owner and hides unassigned legacy data', async () => {
    await asUser(owner, async () => {
      expect((await db.query('select id from public.lists')).rows).toEqual([{ id: 'owner' }]);
      expect((await db.query('select text from public.tasks')).rows).toEqual([{ text: 'Owner task' }]);
    });
    await asUser(other, async () => {
      expect((await db.query('select id from public.lists')).rows).toEqual([{ id: 'other' }]);
    });
  });

  it('allows the owner to create, update, move, and delete their own tasks', async () => {
    await asUser(owner, async () => {
      await db.query("insert into public.lists(id,name) values ('new','New list')");
      await db.query("update public.lists set name='Renamed' where id='new'");
      const inserted = await db.query("insert into public.tasks(list_id,text) values ('owner','New task') returning id");
      const id = inserted.rows[0].id;
      expect((await db.query("update public.tasks set done=true,list_id='new' where id=$1 returning done", [id])).rows).toEqual([{ done: true }]);
      expect((await db.query('delete from public.tasks where id=$1 returning id', [id])).rows).toHaveLength(1);
      expect((await db.query("delete from public.lists where id='new' returning id")).rows).toHaveLength(1);
    });
  });

  it('cannot update or delete another account’s rows', async () => {
    await asUser(other, async () => {
      expect((await db.query("update public.tasks set done=true where list_id='owner' returning id")).rows).toEqual([]);
      expect((await db.query("delete from public.tasks where list_id='owner' returning id")).rows).toEqual([]);
      expect((await db.query("update public.lists set name='bad' where id='owner' returning id")).rows).toEqual([]);
      expect((await db.query("delete from public.lists where id='owner' returning id")).rows).toEqual([]);
    });
  });

  it.each([
    "insert into public.tasks(list_id,text) values ('other','bad')",
    "update public.tasks set list_id='other' where list_id='owner'",
    "update public.tasks set list_id='legacy' where list_id='owner'",
    `update public.lists set owner_id='${other}' where id='owner'`,
    `insert into public.lists(id,name,owner_id) values ('bad','bad','${other}')`,
    'insert into public.lists(id,name,owner_id) values (\'bad\',\'bad\',null)',
  ])('rejects cross-owner or unowned writes: %s', async (sql) => {
    await expect(asUser(owner, () => db.query(sql))).rejects.toThrow(/row-level security/);
  });

  it('prevents claiming unassigned legacy lists', async () => {
    await asUser(owner, async () => {
      expect((await db.query("update public.lists set owner_id=$1 where id='legacy' returning id", [owner])).rows).toEqual([]);
    });
  });

  it('denies Supabase anonymous-auth users even with a matching user id', async () => {
    await asUser(owner, async () => {
      expect((await db.query('select * from public.lists')).rows).toEqual([]);
      expect((await db.query('select * from public.tasks')).rows).toEqual([]);
    }, true);
    await expect(asUser(owner, () => db.query("insert into public.tasks(list_id,text) values ('owner','bad')"), true)).rejects.toThrow(/row-level security/);
  });

  it('removes unnecessary client privileges and unrestricted policies', async () => {
    expect((await db.query("select has_table_privilege('authenticated','public.tasks','TRUNCATE') as allowed")).rows).toEqual([{ allowed: false }]);
    expect((await db.query("select policyname from pg_policies where schemaname='public' and roles @> array['public']::name[]")).rows).toEqual([]);
  });

  it('assigns legacy lists only to an explicitly chosen, verified account without altering tasks', async () => {
    await db.exec('begin');
    try {
      await db.exec("set local tasks.owner_email='owner@example.test'; set local tasks.expected_unowned_lists='1';");
      await db.exec(backfill);
      expect((await db.query("select owner_id from public.lists where id='legacy'")).rows).toEqual([{ owner_id: owner }]);
      expect((await db.query("select text from public.tasks where list_id='legacy'")).rows).toEqual([{ text: 'Existing task' }]);
    } finally { await db.exec('rollback'); }
  });

  it.each(['unverified', 'wrong count', 'unknown email'])('aborts unsafe ownership assignment: %s', async (reason) => {
    await db.exec('begin');
    try {
      await db.exec("set local tasks.owner_email='owner@example.test'; set local tasks.expected_unowned_lists='1';");
      if (reason === 'unverified') await db.query('update auth.users set email_confirmed_at=null where id=$1', [owner]);
      if (reason === 'wrong count') await db.exec("set local tasks.expected_unowned_lists='2'");
      if (reason === 'unknown email') await db.exec("set local tasks.owner_email='unknown@example.test'");
      await expect(db.exec(backfill)).rejects.toThrow();
    } finally { await db.exec('rollback'); }
  });
});
