import { SouhubStatus } from "@/components/souhub-workspace";
type Props = { showConfig?: boolean; variant?: "default" | "canvas"; onOpenShortcuts?: () => void; onOpenPlugins?: () => void };
export function UserStatusActions(_props: Props) { return <SouhubStatus />; }
