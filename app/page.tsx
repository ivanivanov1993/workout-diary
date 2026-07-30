import { getChatGPTUser } from "./chatgpt-auth";
import WorkoutApp from "./WorkoutApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <WorkoutApp
      viewer={{
        name: user?.fullName ?? user?.displayName ?? "",
        email: user?.email ?? "local@device",
        authenticated: Boolean(user),
      }}
    />
  );
}
