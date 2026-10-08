import { ModulesManager } from "@/components/superadmin/modules-manager";

export const dynamic = "force-dynamic";

/**
 * /superadmin/modules
 *
 * SUPERADMIN-only page that toggles every platform feature as a
 * module. Each module is a card with a Switch; flipping a module
 * disables that feature for ALL roles across the entire platform.
 *
 * The page is a thin server component that just mounts the client
 * manager — all TanStack Query + optimistic-state logic lives in
 * {@link ModulesManager}.
 */
export default function SuperAdminModulesPage() {
  return <ModulesManager />;
}
