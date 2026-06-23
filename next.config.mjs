/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '*': ['data/admission/**', 'data/score_rank/**'],
  },
};

export default nextConfig;
