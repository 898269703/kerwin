import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import Page from '../app/page';

describe('PDF Finder production shell', () => {
  test('renders the verified production search shell', () => {
    render(<Page />);
    expect(screen.getByText('PDF Finder')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '找到你真正需要的 PDF' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('例如：国家电网财〔2014〕156号')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument();
    expect(screen.getByText('自有库优先 · 文号强匹配 · 官方来源优先')).toBeInTheDocument();
    expect(screen.getByText('国家电网财〔2014〕156号')).toBeInTheDocument();
    expect(screen.getByText('输变电工程 全生命周期 碳排放 核算')).toBeInTheDocument();
    expect(screen.getByText('电力建设工程 预算定额')).toBeInTheDocument();
  });
});
