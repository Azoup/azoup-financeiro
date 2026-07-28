import { ParalisadosRetornoAlert } from '@/components/notificacoes/ParalisadosRetornoAlert';
import { useAuth } from '@/context/AuthContext';
import {
  countNotificacoesNaoLidas,
  sincronizarNotificacoesParalisados,
  type Notificacao,
} from '@/services/notificacaoService';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type NotificationsContextValue = {
  unread: number;
  refreshUnread: () => Promise<void>;
  syncParalisados: (opts?: { showAlert?: boolean }) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications deve ser usado dentro de NotificationsProvider.');
  }
  return ctx;
}

/** Versão segura para headers (não quebra se o provider ainda não montou). */
export function useNotificationsOptional(): NotificationsContextValue | null {
  return useContext(NotificationsContext);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [alertaItens, setAlertaItens] = useState<Notificacao[]>([]);
  const [alertaOpen, setAlertaOpen] = useState(false);
  const syncing = useRef(false);

  const refreshUnread = useCallback(async () => {
    if (!user?.id) {
      setUnread(0);
      return;
    }
    try {
      setUnread(await countNotificacoesNaoLidas(user.id));
    } catch {
      setUnread(0);
    }
  }, [user?.id]);

  const syncParalisados = useCallback(
    async (opts?: { showAlert?: boolean }) => {
      if (!user?.id || syncing.current) return;
      syncing.current = true;
      const showAlert = opts?.showAlert !== false;
      try {
        const { novasParaAlerta } = await sincronizarNotificacoesParalisados(user.id);
        if (showAlert && novasParaAlerta.length) {
          setAlertaItens(novasParaAlerta);
          setAlertaOpen(true);
        }
        await refreshUnread();
      } catch {
        await refreshUnread();
      } finally {
        syncing.current = false;
      }
    },
    [user?.id, refreshUnread],
  );

  useEffect(() => {
    void syncParalisados({ showAlert: true });
    const t = setInterval(() => void refreshUnread(), 60_000);
    return () => clearInterval(t);
  }, [syncParalisados, refreshUnread]);

  const value = useMemo(
    () => ({ unread, refreshUnread, syncParalisados }),
    [unread, refreshUnread, syncParalisados],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <ParalisadosRetornoAlert
        visible={alertaOpen}
        itens={alertaItens}
        onClose={() => {
          setAlertaOpen(false);
          setAlertaItens([]);
          void refreshUnread();
        }}
      />
    </NotificationsContext.Provider>
  );
}
