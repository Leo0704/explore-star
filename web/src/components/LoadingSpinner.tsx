export function LoadingSpinner({ message = '加载中…' }: { message?: string }) {
  return <div className="loading">⟳ {message}</div>;
}
