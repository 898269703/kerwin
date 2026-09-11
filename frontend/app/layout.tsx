import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PDF Finder',
  description: '搜索、抓取并下载公开来源中的 PDF 文件',
  applicationName: 'PDF Finder',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
