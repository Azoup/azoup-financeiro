import { useAuth } from '@/context/AuthContext';
import { atribuirClientesSemEmpresaAoEmitenteUm, ensureEmitentes } from '@/services/nfseEmitenteService';
import type { NfseEmitente } from '@/types/notaFiscal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'azoup.empresa.filtro';

export type EmpresaFiltroId = 'todos' | string;

type EmpresaFiltroContextValue = {
  empresaId: EmpresaFiltroId;
  setEmpresaId: (id: EmpresaFiltroId) => void;
  emitentes: NfseEmitente[];
  loading: boolean;
  empresaSelecionada: NfseEmitente | null;
  /** true quando o registro pertence à empresa do menu (ou o filtro é Todos). */
  matchEmpresa: (...emitenteIds: Array<string | null | undefined>) => boolean;
  /**
   * Empresa sugerida na emissão: a do menu, se não for Todos;
   * senão a empresa marcada no cadastro do cliente.
   */
  emitenteInicial: (clienteEmitenteId?: string | null) => string | undefined;
};

const EmpresaFiltroContext = createContext<EmpresaFiltroContextValue | null>(null);

export function EmpresaFiltroProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [empresaId, setEmpresaIdState] = useState<EmpresaFiltroId>('todos');
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (alive && raw) setEmpresaIdState(raw);
      } catch {
        /* ignora */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setEmitentes([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void ensureEmitentes(user.id)
      .then((list) => {
        if (alive) setEmitentes(list);
        return atribuirClientesSemEmpresaAoEmitenteUm(user.id);
      })
      .catch(() => {
        if (alive) setEmitentes([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const setEmpresaId = useCallback((id: EmpresaFiltroId) => {
    setEmpresaIdState(id);
    void AsyncStorage.setItem(STORAGE_KEY, id).catch(() => undefined);
  }, []);

  const empresaSelecionada = useMemo(
    () => (empresaId === 'todos' ? null : emitentes.find((e) => e.id === empresaId) ?? null),
    [empresaId, emitentes],
  );

  useEffect(() => {
    if (loading) return;
    if (empresaId !== 'todos' && !emitentes.some((e) => e.id === empresaId)) {
      setEmpresaId('todos');
    }
  }, [loading, empresaId, emitentes, setEmpresaId]);

  const matchEmpresa = useCallback(
    (...emitenteIds: Array<string | null | undefined>) => {
      if (empresaId === 'todos') return true;
      return emitenteIds.some((id) => id === empresaId);
    },
    [empresaId],
  );

  const emitenteInicial = useCallback(
    (clienteEmitenteId?: string | null) => {
      if (empresaId !== 'todos') return empresaId;
      const id = clienteEmitenteId?.trim();
      return id || undefined;
    },
    [empresaId],
  );

  const value = useMemo(
    () => ({
      empresaId,
      setEmpresaId,
      emitentes,
      loading,
      empresaSelecionada,
      matchEmpresa,
      emitenteInicial,
    }),
    [empresaId, setEmpresaId, emitentes, loading, empresaSelecionada, matchEmpresa, emitenteInicial],
  );

  return <EmpresaFiltroContext.Provider value={value}>{children}</EmpresaFiltroContext.Provider>;
}

export function useEmpresaFiltro(): EmpresaFiltroContextValue {
  const ctx = useContext(EmpresaFiltroContext);
  if (!ctx) {
    throw new Error('useEmpresaFiltro deve ser usado dentro de EmpresaFiltroProvider.');
  }
  return ctx;
}
