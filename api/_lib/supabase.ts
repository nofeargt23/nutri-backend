// api/_lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE!; // service role
export const sbAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });

// Extrae el token "Bearer xxx" del header Authorization
export function getBearer(req: any): string | null {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const [type, token] = String(h).split(' ');
  if (type?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

// Valida el token de usuario y devuelve el user
export async function getUserFromReq(req: any) {
  const token = getBearer(req);
  if (!token) return { user: null, error: 'missing_token' };
  const { data, error } = await sbAdmin.auth.getUser(token);
  if (error || !data?.user) return { user: null, error: 'invalid_token' };
  return { user: data.user, error: null };
}
