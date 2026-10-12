import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getSupabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL;
}

function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseServiceRoleKey());
}

let clientInstance: SupabaseClient | null = null;
let injectedClient: SupabaseClient | null = null;

export function setSupabaseClient(client: SupabaseClient | null): void {
  injectedClient = client;
}

export function getSupabaseClient(): SupabaseClient {
  if (injectedClient) {
    return injectedClient;
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseKey) {
    throw new SupabaseConfigError(
      'Supabase no está configurado. Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      db: {
        schema: 'public',
      },
      global: {
        headers: {
          'x-client-info': 'vendefacil-app',
        },
      },
    });
  }

  return clientInstance;
}

export async function callRpc<T = unknown>(
  functionName: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const client = getSupabaseClient();

  const { data, error } = await client.rpc(functionName, params);

  if (error) {
    throw new Error(`RPC ${functionName} falló: ${error.message}`);
  }

  return data as T;
}

export function resetSupabaseClient(): void {
  clientInstance = null;
  injectedClient = null;
}
