'use client';

import dynamic from 'next/dynamic';

const BackendCardImpl = dynamic(
  () => import('./backend-card').then((m) => m.BackendCard),
  { ssr: false, loading: () => null }
);

interface Props {
  className?: string;
}

export function BackendCardLazy({ className }: Props) {
  return <BackendCardImpl {...(className !== undefined ? { className } : {})} />;
}
