import withBundleAnalyzer from '@next/bundle-analyzer';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
  analyzerMode: 'json',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, process: false };
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.env.NEXT_PUBLIC_EXTENSION_ID': JSON.stringify(
            process.env.NEXT_PUBLIC_EXTENSION_ID ?? '',
          ),
          'process.env.NEXT_PUBLIC_RUNNER_PORT': JSON.stringify(
            process.env.NEXT_PUBLIC_RUNNER_PORT ?? '5174',
          ),
        }),
      );
    }
    return config;
  },
};

export default bundleAnalyzer(withNextIntl(nextConfig));
