import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

interface AsyncResourceState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  requestId: number;
}

type AsyncResourceAction<T> =
  | { type: 'load_started'; requestId: number }
  | { type: 'load_succeeded'; requestId: number; data: T }
  | { type: 'load_failed'; requestId: number; error: string };

interface UseAsyncResourceOptions<T> {
  initialData?: T | null;
}

function asyncResourceReducer<T>(
  state: AsyncResourceState<T>,
  action: AsyncResourceAction<T>,
): AsyncResourceState<T> {
  if (action.requestId < state.requestId) {
    return state;
  }

  switch (action.type) {
    case 'load_started':
      return {
        ...state,
        isLoading: true,
        error: null,
        requestId: action.requestId,
      };
    case 'load_succeeded':
      return {
        data: action.data,
        isLoading: false,
        error: null,
        requestId: action.requestId,
      };
    case 'load_failed':
      return {
        ...state,
        isLoading: false,
        error: action.error,
        requestId: action.requestId,
      };
  }
}

export function useAsyncResource<T>(
  load: () => Promise<T>,
  options: UseAsyncResourceOptions<T> = {},
) {
  const nextRequestId = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  const initialState: AsyncResourceState<T> = {
    data: options.initialData ?? null,
    isLoading: true,
    error: null,
    requestId: 0,
  };
  const [state, dispatch] = useReducer(asyncResourceReducer<T>, initialState);

  useEffect(() => {
    let cancelled = false;
    const requestId = nextRequestId.current + 1;
    nextRequestId.current = requestId;

    dispatch({ type: 'load_started', requestId });

    load()
      .then((data) => {
        if (!cancelled) {
          dispatch({ type: 'load_succeeded', requestId, data });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          dispatch({
            type: 'load_failed',
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  return {
    ...state,
    reload,
  };
}
