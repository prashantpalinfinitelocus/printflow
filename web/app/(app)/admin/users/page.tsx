import { PageHeader } from "@/components/Shell";
import { apiJson, getCurrentUser } from "@/lib/session";
import type { Store, User } from "@/lib/types";

import { UserManager } from "./UserManager";

export default async function UsersPage() {
  const [users, stores, me] = await Promise.all([
    apiJson<User[]>("/users"),
    apiJson<Store[]>("/stores"),
    getCurrentUser(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Access control"
        title="Users"
        description="Operators see exactly one store's queue. Admins see everything and manage master data."
      />
      <UserManager initial={users ?? []} stores={stores ?? []} currentUserId={me?.id ?? 0} />
    </>
  );
}
