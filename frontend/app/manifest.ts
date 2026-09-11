import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PDF Finder',
    short_name: 'PDF Finder',
    description: '搜索、抓取并下载公开来源中的 PDF 文件',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
  };
}
