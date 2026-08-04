import { AppShell } from '@/components/layout/AppShell';
import { ConfirmDialogProvider } from '@/components/shared';

export default function App() {
  return <ConfirmDialogProvider><AppShell /></ConfirmDialogProvider>;
}
