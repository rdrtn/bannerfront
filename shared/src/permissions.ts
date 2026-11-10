export const ROLES = ['admin', 'designer', 'operacional', 'atendimento'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  designer: 'Designer',
  operacional: 'Operacional',
  atendimento: 'Atendimento',
};

/**
 * Matriz de permissões por perfil.
 *
 * - Admin: tudo, incluindo o painel de configuração (limpar cache e arquivos
 *   temporários, apagar projetos e criativos, criar usuários).
 * - Designer: ferramenta de animação (Modo Básico e Avançado) e templates.
 * - Operacional: só cria peças novas a partir de templates.
 * - Atendimento: só visualiza os criativos finalizados.
 *
 * Qualquer perfil pode subir fontes, desde que confirme a licença.
 */
export const PERMISSIONS = {
  'users:manage': ['admin'],
  'system:manage': ['admin'],
  'projects:read': ['admin', 'designer', 'operacional'],
  'projects:write': ['admin', 'designer'],
  'projects:delete': ['admin'],
  'templates:write': ['admin', 'designer'],
  'pieces:create': ['admin', 'designer', 'operacional'],
  'creatives:read': ['admin', 'designer', 'operacional', 'atendimento'],
  'fonts:read': ['admin', 'designer', 'operacional', 'atendimento'],
  'fonts:upload': ['admin', 'designer', 'operacional', 'atendimento'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
