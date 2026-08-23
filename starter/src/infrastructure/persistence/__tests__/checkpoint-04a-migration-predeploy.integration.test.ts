import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const predeployEnabled =
  process.env.AFTERFRAME_DB_MIGRATION_PREFLIGHT === "1";
const describeDatabase = predeployEnabled ? describe : describe.skip;
const starterRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/008_identity_causal_manifests.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");

const baselineMigrationVersions = [
  "001",
  "002",
  "003",
  "004",
  "005",
  "006",
  "007",
] as const;

const serviceRpcDeclarations = [
  "public.af_get_research_identity_context_v1(uuid,uuid,uuid)",
  "public.af_get_resolved_subject_identity_v1(uuid,uuid)",
  "public.af_claim_research_job_v2(uuid,uuid,uuid,public.af_research_stage,bigint,bigint,text,uuid,text,jsonb,integer)",
  "public.af_complete_research_job_v2(uuid,jsonb,text,jsonb,text,jsonb)",
] as const;

const retiredServiceRpcDeclarations = [
  "public.af_claim_research_job_v1(uuid,uuid,uuid,public.af_research_stage,bigint,bigint,text,text,uuid,text,jsonb,integer)",
  "public.af_complete_research_job_v1(uuid,jsonb,text,jsonb,text,jsonb)",
] as const;

const helperFunctionNames = [
  "af_canonical_jsonb_sha256_v1",
  "af_subject_ref_fingerprint_v1",
  "af_public_identity_names_valid_v1",
  "af_assert_identity_output_link_v1",
  "af_enforce_case_research_identity_immutability_v1",
  "af_reject_identity_manifest_mutation_v1",
  "af_resolved_subject_identity_valid_v1",
  "af_resolved_subject_identity_record_json_v1",
  "af_attempt_input_manifest_envelope_json_v1",
  "af_identity_requirement_ids_valid_v1",
  "af_research_start_result_shape_valid",
  "af_identity_requirements_valid_v1",
  "af_identity_resolution_partition_valid_v1",
  "af_research_stage_result_v2_valid",
  "af_resolved_subject_identity_matches_v1",
] as const;

const expectedTriggerFunctions = new Map([
  [
    "af_research_outputs_identity_link_trigger",
    "af_assert_identity_output_link_v1",
  ],
  [
    "af_cases_research_identity_immutability_trigger",
    "af_enforce_case_research_identity_immutability_v1",
  ],
  [
    "af_resolved_identities_immutable_trigger",
    "af_reject_identity_manifest_mutation_v1",
  ],
  [
    "af_attempt_manifests_immutable_trigger",
    "af_reject_identity_manifest_mutation_v1",
  ],
]);

const expectedConstraintPosture = [
  ...[
    "af_attempt_manifests_manifest_object_check",
    "af_attempt_manifests_publication_authority_check",
    "af_attempt_manifests_schema_version_check",
    "af_attempt_manifests_stage_shape_check",
  ].map((constraint_name) => ({
    table_name: "af_research_attempt_input_manifests",
    constraint_name,
    constraint_type: "c",
    deferrable: false,
    initially_deferred: false,
    validated: true,
  })),
  ...[
    "af_attempt_manifests_attempt_fk",
    "af_attempt_manifests_identity_fk",
    "af_attempt_manifests_predecessor_attempt_fk",
    "af_attempt_manifests_predecessor_job_fk",
    "af_attempt_manifests_predecessor_output_fk",
    "af_attempt_manifests_run_case_fk",
  ].map((constraint_name) => ({
    table_name: "af_research_attempt_input_manifests",
    constraint_name,
    constraint_type: "f",
    deferrable: false,
    initially_deferred: false,
    validated: true,
  })),
  {
    table_name: "af_research_attempt_input_manifests",
    constraint_name: "af_attempt_manifests_pkey",
    constraint_type: "p",
    deferrable: false,
    initially_deferred: false,
    validated: true,
  },
  ...[
    "af_attempt_manifests_attempt_key",
    "af_attempt_manifests_run_manifest_key",
    "af_attempt_manifests_run_request_key",
  ].map((constraint_name) => ({
    table_name: "af_research_attempt_input_manifests",
    constraint_name,
    constraint_type: "u",
    deferrable: false,
    initially_deferred: false,
    validated: true,
  })),
  {
    table_name: "af_research_stage_outputs",
    constraint_name: "af_research_outputs_identity_link_trigger",
    constraint_type: "t",
    deferrable: true,
    initially_deferred: true,
    validated: true,
  },
  ...[
    ["af_research_outputs_causal_reference_key", "u"],
    ["af_research_outputs_nonidentity_link_check", "c"],
    ["af_research_outputs_one_per_attempt_key", "u"],
  ].map(([constraint_name, constraint_type]) => ({
    table_name: "af_research_stage_outputs",
    constraint_name,
    constraint_type,
    deferrable: false,
    initially_deferred: false,
    validated: true,
  })),
  {
    table_name: "af_research_stage_outputs",
    constraint_name: "af_research_outputs_subject_identity_fk",
    constraint_type: "f",
    deferrable: true,
    initially_deferred: true,
    validated: true,
  },
  ...[
    "af_resolved_identities_alternate_names_check",
    "af_resolved_identities_data_class_check",
    "af_resolved_identities_disambiguators_check",
    "af_resolved_identities_display_name_check",
    "af_resolved_identities_evidence_status_check",
    "af_resolved_identities_provenance_check",
    "af_resolved_identities_publication_authority_check",
    "af_resolved_identities_review_state_check",
    "af_resolved_identities_schema_version_check",
    "af_resolved_identities_time_check",
    "af_resolved_identities_verification_state_check",
  ].map((constraint_name) => ({
    table_name: "af_resolved_subject_identities",
    constraint_name,
    constraint_type: "c",
    deferrable: false,
    initially_deferred: false,
    validated: true,
  })),
  ...["af_resolved_identities_attempt_fk", "af_resolved_identities_run_case_fk"].map(
    (constraint_name) => ({
      table_name: "af_resolved_subject_identities",
      constraint_name,
      constraint_type: "f",
      deferrable: false,
      initially_deferred: false,
      validated: true,
    }),
  ),
  {
    table_name: "af_resolved_subject_identities",
    constraint_name: "af_resolved_identities_pkey",
    constraint_type: "p",
    deferrable: false,
    initially_deferred: false,
    validated: true,
  },
  ...[
    "af_resolved_identities_attempt_key",
    "af_resolved_identities_run_attempt_identity_key",
    "af_resolved_identities_run_identity_key",
    "af_resolved_identities_run_key",
  ].map((constraint_name) => ({
    table_name: "af_resolved_subject_identities",
    constraint_name,
    constraint_type: "u",
    deferrable: false,
    initially_deferred: false,
    validated: true,
  })),
].toSorted((left, right) =>
  `${left.table_name}.${left.constraint_name}`.localeCompare(
    `${right.table_name}.${right.constraint_name}`,
  ),
);

function loadDatabaseUrl() {
  if (process.env.SUPABASE_DB_URL === undefined) {
    try {
      process.loadEnvFile(`${starterRoot}/.env.local`);
    } catch {
      throw new Error(
        "Migration-008 predeploy validation requires SUPABASE_DB_URL or starter/.env.local",
      );
    }
  }
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error(
      "Migration-008 predeploy validation requires a configured SUPABASE_DB_URL",
    );
  }
  try {
    const parsed = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      parsed.username.length === 0 ||
      parsed.password.length === 0 ||
      parsed.hostname.length === 0 ||
      parsed.pathname.length <= 1
    ) {
      throw new Error("invalid database URL");
    }
  } catch {
    throw new Error(
      "Migration-008 predeploy validation requires a credentialed PostgreSQL URL",
    );
  }
  return databaseUrl;
}

function quoteIdentifier(identifier: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error("Predeploy SQL identifier is outside the allowlist");
  }
  return `"${identifier}"`;
}

async function migrationVersions(client: Client) {
  const result = await client.query<{ version: string }>(
    `select version::text as version
     from supabase_migrations.schema_migrations
     order by version`,
  );
  return result.rows.map(({ version }) => version);
}

async function afTables(client: Client) {
  const result = await client.query<{
    table_name: string;
    relation_kind: string;
    row_security: boolean;
    force_row_security: boolean;
    owner_name: string;
    access_control: string;
  }>(
    `select relation.relname as table_name,
       relation.relkind::text as relation_kind,
       relation.relrowsecurity as row_security,
       relation.relforcerowsecurity as force_row_security,
       pg_catalog.pg_get_userbyid(relation.relowner) as owner_name,
       coalesce(relation.relacl::text, '') as access_control
     from pg_catalog.pg_class relation
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relkind in ('r', 'p')
       and relation.relname like 'af\\_%' escape '\\'
     order by relation.relname`,
  );
  return result.rows;
}

async function afRowCounts(client: Client) {
  const tables = await afTables(client);
  const counts: Array<Readonly<{ table_name: string; row_count: string }>> = [];
  for (const { table_name } of tables) {
    const result = await client.query<{ row_count: string }>(
      `select count(*)::text as row_count
       from public.${quoteIdentifier(table_name)}`,
    );
    counts.push({
      table_name,
      row_count: result.rows[0]?.row_count ?? "0",
    });
  }
  return counts;
}

async function afColumns(client: Client) {
  const result = await client.query<{
    table_name: string;
    ordinal: number;
    column_name: string;
    data_type: string;
    not_null: boolean;
    default_expression: string;
  }>(
    `select relation.relname as table_name,
       attribute.attnum as ordinal,
       attribute.attname as column_name,
       pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as data_type,
       attribute.attnotnull as not_null,
       coalesce(
         pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid),
         ''
       ) as default_expression
     from pg_catalog.pg_class relation
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation.relnamespace
     join pg_catalog.pg_attribute attribute
       on attribute.attrelid = relation.oid
     left join pg_catalog.pg_attrdef default_value
       on default_value.adrelid = relation.oid
       and default_value.adnum = attribute.attnum
     where namespace.nspname = 'public'
       and relation.relkind in ('r', 'p')
       and relation.relname like 'af\\_%' escape '\\'
       and attribute.attnum > 0
       and not attribute.attisdropped
     order by relation.relname, attribute.attnum`,
  );
  return result.rows;
}

async function afConstraints(client: Client) {
  const result = await client.query<{
    table_name: string;
    constraint_name: string;
    constraint_type: string;
    deferrable: boolean;
    initially_deferred: boolean;
    validated: boolean;
    definition: string;
  }>(
    `select relation.relname as table_name,
       constraint_record.conname as constraint_name,
       constraint_record.contype::text as constraint_type,
       constraint_record.condeferrable as deferrable,
       constraint_record.condeferred as initially_deferred,
       constraint_record.convalidated as validated,
       pg_catalog.pg_get_constraintdef(constraint_record.oid, true) as definition
     from pg_catalog.pg_constraint constraint_record
     join pg_catalog.pg_class relation
       on relation.oid = constraint_record.conrelid
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname like 'af\\_%' escape '\\'
     order by relation.relname, constraint_record.conname`,
  );
  return result.rows;
}

async function afTriggers(client: Client) {
  const result = await client.query<{
    table_name: string;
    trigger_name: string;
    function_name: string;
    enabled_state: string;
    internal: boolean;
    constraint_trigger: boolean;
    deferrable: boolean;
    initially_deferred: boolean;
    definition: string;
  }>(
    `select relation.relname as table_name,
       trigger_record.tgname as trigger_name,
       procedure.proname as function_name,
       trigger_record.tgenabled::text as enabled_state,
       trigger_record.tgisinternal as internal,
       trigger_record.tgconstraint <> 0 as constraint_trigger,
       coalesce(constraint_record.condeferrable, false) as deferrable,
       coalesce(constraint_record.condeferred, false) as initially_deferred,
       pg_catalog.pg_get_triggerdef(trigger_record.oid, true) as definition
     from pg_catalog.pg_trigger trigger_record
     join pg_catalog.pg_class relation on relation.oid = trigger_record.tgrelid
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation.relnamespace
     join pg_catalog.pg_proc procedure
       on procedure.oid = trigger_record.tgfoid
     left join pg_catalog.pg_constraint constraint_record
       on constraint_record.oid = trigger_record.tgconstraint
     where namespace.nspname = 'public'
       and relation.relname like 'af\\_%' escape '\\'
       and not trigger_record.tgisinternal
     order by relation.relname, trigger_record.tgname`,
  );
  return result.rows;
}

async function afIndexes(client: Client) {
  const result = await client.query<{
    table_name: string;
    index_name: string;
    definition: string;
  }>(
    `select tablename as table_name,
       indexname as index_name,
       indexdef as definition
     from pg_catalog.pg_indexes
     where schemaname = 'public'
       and tablename like 'af\\_%' escape '\\'
     order by tablename, indexname`,
  );
  return result.rows;
}

async function afFunctions(client: Client) {
  const result = await client.query<{
    signature: string;
    return_type: string;
    function_kind: string;
    volatility: string;
    security_definer: boolean;
    leakproof: boolean;
    parallel_safety: string;
    configuration: string;
    access_control: string;
    definition: string;
  }>(
    `select format('%I.%s', namespace.nspname, procedure.oid::regprocedure)
         as signature,
       pg_catalog.pg_get_function_result(procedure.oid) as return_type,
       procedure.prokind::text as function_kind,
       procedure.provolatile::text as volatility,
       procedure.prosecdef as security_definer,
       procedure.proleakproof as leakproof,
       procedure.proparallel::text as parallel_safety,
       coalesce(procedure.proconfig::text, '') as configuration,
       coalesce(procedure.proacl::text, '') as access_control,
       pg_catalog.pg_get_functiondef(procedure.oid) as definition
     from pg_catalog.pg_proc procedure
     join pg_catalog.pg_namespace namespace
       on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname like 'af\\_%' escape '\\'
     order by signature`,
  );
  return result.rows;
}

async function afPolicies(client: Client) {
  const result = await client.query<{
    table_name: string;
    policy_name: string;
    command: string;
    permissive: boolean;
    roles: string;
    using_expression: string;
    check_expression: string;
  }>(
    `select relation.relname as table_name,
       policy.polname as policy_name,
       policy.polcmd::text as command,
       policy.polpermissive as permissive,
       policy.polroles::text as roles,
       coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '')
         as using_expression,
       coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')
         as check_expression
     from pg_catalog.pg_policy policy
     join pg_catalog.pg_class relation on relation.oid = policy.polrelid
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname like 'af\\_%' escape '\\'
     order by relation.relname, policy.polname`,
  );
  return result.rows;
}

async function afRelationPrivilegeLeaks(client: Client) {
  const result = await client.query<{
    relation_name: string;
    grantee: string;
    privilege_type: string;
    grantable: boolean;
  }>(
    `select relation.relname as relation_name,
       case
         when expanded_acl.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(expanded_acl.grantee)
       end as grantee,
       expanded_acl.privilege_type,
       expanded_acl.is_grantable as grantable
     from pg_catalog.pg_class relation
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation.relnamespace
     cross join lateral pg_catalog.aclexplode(
       coalesce(
         relation.relacl,
         pg_catalog.acldefault('r', relation.relowner)
       )
     ) expanded_acl
     where namespace.nspname = 'public'
       and relation.relkind in ('r', 'p')
       and relation.relname like 'af\\_%' escape '\\'
       and (
         expanded_acl.grantee = 0
         or pg_catalog.pg_get_userbyid(expanded_acl.grantee)
           in ('anon', 'authenticated')
       )
     order by relation.relname, grantee, expanded_acl.privilege_type`,
  );
  return result.rows;
}

async function newIdentityTableServicePrivilegeLeaks(client: Client) {
  const result = await client.query<{
    relation_name: string;
    privilege_type: string;
    grantable: boolean;
  }>(
    `select relation.relname as relation_name,
       expanded_acl.privilege_type,
       expanded_acl.is_grantable as grantable
     from pg_catalog.pg_class relation
     join pg_catalog.pg_namespace namespace
       on namespace.oid = relation.relnamespace
     cross join lateral pg_catalog.aclexplode(
       coalesce(
         relation.relacl,
         pg_catalog.acldefault('r', relation.relowner)
       )
     ) expanded_acl
     where namespace.nspname = 'public'
       and relation.relname = any($1::text[])
       and pg_catalog.pg_get_userbyid(expanded_acl.grantee) = 'service_role'
     order by relation.relname, expanded_acl.privilege_type`,
    [[
      "af_resolved_subject_identities",
      "af_research_attempt_input_manifests",
    ]],
  );
  return result.rows;
}

async function afBrowserFunctionPrivilegeLeaks(client: Client) {
  const result = await client.query<{
    signature: string;
    grantee: string;
    privilege_type: string;
    grantable: boolean;
  }>(
    `select format('%I.%s', namespace.nspname, procedure.oid::regprocedure)
         as signature,
       case
         when expanded_acl.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(expanded_acl.grantee)
       end as grantee,
       expanded_acl.privilege_type,
       expanded_acl.is_grantable as grantable
     from pg_catalog.pg_proc procedure
     join pg_catalog.pg_namespace namespace
       on namespace.oid = procedure.pronamespace
     cross join lateral pg_catalog.aclexplode(
       coalesce(
         procedure.proacl,
         pg_catalog.acldefault('f', procedure.proowner)
       )
     ) expanded_acl
     where namespace.nspname = 'public'
       and procedure.proname like 'af\\_%' escape '\\'
       and (
         expanded_acl.grantee = 0
         or pg_catalog.pg_get_userbyid(expanded_acl.grantee)
           in ('anon', 'authenticated')
       )
     order by signature, grantee, expanded_acl.privilege_type`,
  );
  return result.rows;
}

async function serviceExecutableAfFunctions(client: Client) {
  const result = await client.query<{ signature: string }>(
    `select format('%I.%s', namespace.nspname, procedure.oid::regprocedure)
         as signature
     from pg_catalog.pg_proc procedure
     join pg_catalog.pg_namespace namespace
       on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname like 'af\\_%' escape '\\'
       and pg_catalog.has_function_privilege(
         'service_role', procedure.oid, 'EXECUTE'
       )
     order by signature`,
  );
  return result.rows.map(({ signature }) => signature);
}

async function canonicalFunctionSignatures(
  client: Client,
  declarations: readonly string[],
) {
  const result: string[] = [];
  for (const declaration of declarations) {
    const signatureResult = await client.query<{ signature: string | null }>(
      `select case
         when pg_catalog.to_regprocedure($1) is null then null
         else format(
           '%I.%s',
           'public',
           pg_catalog.to_regprocedure($1)::regprocedure
         )
       end as signature`,
      [declaration],
    );
    const signature = signatureResult.rows[0]?.signature;
    if (signature === null || signature === undefined) {
      throw new Error(`Required function is absent: ${declaration}`);
    }
    result.push(signature);
  }
  return result.sort();
}

async function helperPrivilegeState(client: Client) {
  const result = await client.query<{
    function_name: string;
    overload_count: string;
    service_executable: boolean;
  }>(
    `select procedure.proname as function_name,
       count(*)::text as overload_count,
       bool_or(
         pg_catalog.has_function_privilege(
           'service_role', procedure.oid, 'EXECUTE'
         )
       ) as service_executable
     from pg_catalog.pg_proc procedure
     join pg_catalog.pg_namespace namespace
       on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname = any($1::text[])
     group by procedure.proname
     order by procedure.proname`,
    [[...helperFunctionNames]],
  );
  return result.rows;
}

async function rpcPosture(
  client: Client,
  declarations: readonly string[],
) {
  const result: Array<
    Readonly<{
      signature: string;
      return_type: string;
      volatility: string;
      security_definer: boolean;
      service_executable: boolean;
    }>
  > = [];
  for (const declaration of declarations) {
    const postureResult = await client.query<{
      signature: string;
      return_type: string;
      volatility: string;
      security_definer: boolean;
      service_executable: boolean;
    }>(
      `select format('%I.%s', namespace.nspname, procedure.oid::regprocedure)
           as signature,
         pg_catalog.pg_get_function_result(procedure.oid) as return_type,
         procedure.provolatile::text as volatility,
         procedure.prosecdef as security_definer,
         pg_catalog.has_function_privilege(
           'service_role', procedure.oid, 'EXECUTE'
         ) as service_executable
       from pg_catalog.pg_proc procedure
       join pg_catalog.pg_namespace namespace
         on namespace.oid = procedure.pronamespace
       where procedure.oid = pg_catalog.to_regprocedure($1)`,
      [declaration],
    );
    const posture = postureResult.rows[0];
    if (posture === undefined) {
      throw new Error(`Required function is absent: ${declaration}`);
    }
    result.push(posture);
  }
  return result;
}

async function catalogSnapshot(client: Client) {
  return {
    migrationVersions: await migrationVersions(client),
    tables: await afTables(client),
    rowCounts: await afRowCounts(client),
    columns: await afColumns(client),
    constraints: await afConstraints(client),
    triggers: await afTriggers(client),
    indexes: await afIndexes(client),
    functions: await afFunctions(client),
    policies: await afPolicies(client),
    relationPrivilegeLeaks: await afRelationPrivilegeLeaks(client),
    browserFunctionPrivilegeLeaks:
      await afBrowserFunctionPrivilegeLeaks(client),
    serviceExecutableFunctions:
      await serviceExecutableAfFunctions(client),
  };
}

describeDatabase("checkpoint 04A migration 008 predeploy", () => {
  it(
    "applies against deployed 001-007, proves the boundary, and restores the exact baseline",
    async () => {
      const client = new Client({
        connectionString: loadDatabaseUrl(),
        ssl: { rejectUnauthorized: false },
        application_name: "afterframe-migration-008-predeploy",
      });
      let advisoryLockHeld = false;
      try {
        try {
          await client.connect();
        } catch (error) {
          const code =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string" &&
            /^[A-Z0-9_]+$/.test(error.code)
              ? error.code
              : "UNKNOWN";
          const message =
            error instanceof Error ? error.message.toLowerCase() : "";
          const reason = message.includes("tenant or user not found")
            ? "TENANT_OR_USER_NOT_FOUND"
            : message.includes("password authentication failed")
              ? "PASSWORD_AUTHENTICATION_FAILED"
              : message.includes("circuit breaker")
                ? "POOLER_CIRCUIT_BREAKER"
                : message.includes("connection refused")
                  ? "CONNECTION_REFUSED"
                  : message.includes("timeout")
                    ? "CONNECTION_TIMEOUT"
                    : "UNCLASSIFIED";
          throw new Error(
            `Migration-008 predeploy validation could not connect using SUPABASE_DB_URL (code: ${code}; reason: ${reason})`,
          );
        }
        await client.query("set search_path = pg_catalog, public");
        await client.query("select pg_catalog.pg_advisory_lock(804008)");
        advisoryLockHeld = true;

        const roles = await client.query<{ role_name: string }>(
          `select rolname as role_name
           from pg_catalog.pg_roles
           where rolname = any($1::text[])
           order by rolname`,
          [["anon", "authenticated", "service_role"]],
        );
        expect(roles.rows.map(({ role_name }) => role_name)).toEqual([
          "anon",
          "authenticated",
          "service_role",
        ]);

        const baseline = await catalogSnapshot(client);
        expect(baseline.migrationVersions).toEqual(baselineMigrationVersions);
        expect(baseline.tables).toHaveLength(30);
        expect(
          baseline.tables.every(
            ({ row_security, force_row_security }) =>
              row_security && force_row_security,
          ),
        ).toBe(true);
        const baselineRowCounts = new Map(
          baseline.rowCounts.map(({ table_name, row_count }) => [
            table_name,
            row_count,
          ]),
        );
        expect(baselineRowCounts.get("af_research_runs")).toBe("0");
        expect(
          baselineRowCounts.get("af_research_start_commit_results"),
        ).toBe("0");
        expect(
          baselineRowCounts.get("af_research_start_idempotency"),
        ).toBe("0");
        const retiredServiceSignatures = await canonicalFunctionSignatures(
          client,
          retiredServiceRpcDeclarations,
        );
        for (const signature of retiredServiceSignatures) {
          expect(baseline.serviceExecutableFunctions).toContain(signature);
        }

        await client.query("begin");
        let validationError: unknown;
        try {
          await client.query("set local lock_timeout = '10s'");
          await client.query("set local statement_timeout = '90s'");
          await client.query(migration);

          const migratedVersions = await migrationVersions(client);
          expect(migratedVersions).toEqual(baselineMigrationVersions);

          const migratedTables = await afTables(client);
          expect(migratedTables).toHaveLength(32);
          expect(
            migratedTables.map(({ table_name }) => table_name),
          ).toEqual(
            [
              ...baseline.tables.map(({ table_name }) => table_name),
              "af_resolved_subject_identities",
              "af_research_attempt_input_manifests",
            ].sort(),
          );
          expect(
            migratedTables.every(
              ({ row_security, force_row_security }) =>
                row_security && force_row_security,
            ),
          ).toBe(true);
          expect(await afPolicies(client)).toEqual([]);
          expect(await afRelationPrivilegeLeaks(client)).toEqual([]);
          expect(await newIdentityTableServicePrivilegeLeaks(client)).toEqual(
            [],
          );
          expect(await afBrowserFunctionPrivilegeLeaks(client)).toEqual([]);

          const serviceRpcSignatures = await canonicalFunctionSignatures(
            client,
            serviceRpcDeclarations,
          );
          const expectedServiceFunctions = new Set(
            baseline.serviceExecutableFunctions,
          );
          for (const signature of retiredServiceSignatures) {
            expectedServiceFunctions.delete(signature);
          }
          for (const signature of baseline.serviceExecutableFunctions) {
            if (
              helperFunctionNames.some((functionName) =>
                signature.startsWith(`public.${functionName}(`),
              )
            ) {
              expectedServiceFunctions.delete(signature);
            }
          }
          for (const signature of serviceRpcSignatures) {
            expectedServiceFunctions.add(signature);
          }
          expect(await serviceExecutableAfFunctions(client)).toEqual(
            [...expectedServiceFunctions].sort(),
          );

          const activeRpcPosture = await rpcPosture(
            client,
            serviceRpcDeclarations,
          );
          expect(activeRpcPosture.map(({ signature }) => signature).sort()).toEqual(
            serviceRpcSignatures,
          );
          for (const posture of activeRpcPosture) {
            expect(posture.return_type).toBe("jsonb");
            expect(posture.security_definer).toBe(true);
            expect(posture.service_executable).toBe(true);
          }
          expect(
            activeRpcPosture.map(({ volatility }) => volatility),
          ).toEqual(["s", "s", "v", "v"]);

          const retiredRpcPosture = await rpcPosture(
            client,
            retiredServiceRpcDeclarations,
          );
          expect(
            retiredRpcPosture.every(
              ({ security_definer, service_executable }) =>
                security_definer && !service_executable,
            ),
          ).toBe(true);

          expect(await helperPrivilegeState(client)).toEqual(
            [...helperFunctionNames]
              .sort()
              .map((function_name) => ({
                function_name,
                overload_count: "1",
                service_executable: false,
              })),
          );

          const baselineTriggerKeys = new Set(
            baseline.triggers.map(
              ({ table_name, trigger_name }) => `${table_name}.${trigger_name}`,
            ),
          );
          const addedTriggers = (await afTriggers(client)).filter(
            ({ table_name, trigger_name }) =>
              !baselineTriggerKeys.has(`${table_name}.${trigger_name}`),
          );
          expect(
            addedTriggers.map(({ trigger_name }) => trigger_name).sort(),
          ).toEqual([...expectedTriggerFunctions.keys()].sort());
          for (const trigger of addedTriggers) {
            expect(trigger.function_name).toBe(
              expectedTriggerFunctions.get(trigger.trigger_name),
            );
            expect(trigger.enabled_state).toBe("O");
            expect(trigger.internal).toBe(false);
          }
          for (const triggerName of [
            "af_resolved_identities_immutable_trigger",
            "af_attempt_manifests_immutable_trigger",
          ]) {
            const immutableTrigger = addedTriggers.find(
              ({ trigger_name }) => trigger_name === triggerName,
            );
            expect(immutableTrigger?.definition).toContain("BEFORE UPDATE");
            expect(immutableTrigger?.definition).not.toContain("DELETE");
          }
          const identityLinkTrigger = addedTriggers.find(
            ({ trigger_name }) =>
              trigger_name === "af_research_outputs_identity_link_trigger",
          );
          expect(identityLinkTrigger).toMatchObject({
            table_name: "af_research_stage_outputs",
            constraint_trigger: true,
            deferrable: true,
            initially_deferred: true,
          });

          const baselineConstraintKeys = new Set(
            baseline.constraints.map(
              ({ table_name, constraint_name }) =>
                `${table_name}.${constraint_name}`,
            ),
          );
          const addedConstraints = (await afConstraints(client)).filter(
            ({ table_name, constraint_name }) =>
              !baselineConstraintKeys.has(`${table_name}.${constraint_name}`),
          );
          expect(
            addedConstraints.map(
              ({
                table_name,
                constraint_name,
                constraint_type,
                deferrable,
                initially_deferred,
                validated,
              }) => ({
                table_name,
                constraint_name,
                constraint_type,
                deferrable,
                initially_deferred,
                validated,
              }),
            ),
          ).toEqual(expectedConstraintPosture);
          expect(
            addedConstraints.find(
              ({ constraint_name }) =>
                constraint_name === "af_research_outputs_one_per_attempt_key",
            ),
          ).toMatchObject({
            table_name: "af_research_stage_outputs",
            constraint_type: "u",
          });
          expect(
            addedConstraints.find(
              ({ constraint_name }) =>
                constraint_name === "af_research_outputs_subject_identity_fk",
            ),
          ).toMatchObject({
            table_name: "af_research_stage_outputs",
            constraint_type: "f",
            deferrable: true,
            initially_deferred: true,
          });

          const outputIdentityColumn = (await afColumns(client)).find(
            ({ table_name, column_name }) =>
              table_name === "af_research_stage_outputs" &&
              column_name === "subject_identity_id",
          );
          expect(outputIdentityColumn).toMatchObject({
            data_type: "uuid",
            not_null: false,
            default_expression: "",
          });
        } catch (error) {
          validationError = error;
        }

        await client.query("rollback");
        const restored = await catalogSnapshot(client);
        expect(restored).toEqual(baseline);
        if (validationError !== undefined) throw validationError;
      } finally {
        if (advisoryLockHeld) {
          await client
            .query("select pg_catalog.pg_advisory_unlock(804008)")
            .catch(() => undefined);
        }
        await client.end().catch(() => undefined);
      }
    },
    120_000,
  );
});
