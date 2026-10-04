import PwaRegister from "../pwa-register";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}<PwaRegister /></>;
}
