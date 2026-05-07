/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb', // resumes
    },
  },
  // pdf-parse uses Node-specific code; mark as external for the server bundle
  serverExternalPackages: ['pdf-parse'],
};

export default nextConfig;
