export default function Loading() {
  return <div aria-live="polite" aria-busy="true" className="space-y-6"><span className="sr-only">Cargando contenido</span><div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" /><div className="overflow-hidden rounded-lg border border-border bg-card"><div className="h-14 animate-pulse border-b border-border bg-muted motion-reduce:animate-none" />{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-12 animate-pulse border-b border-border bg-card last:border-0 motion-reduce:animate-none" />)}</div></div>;
}
