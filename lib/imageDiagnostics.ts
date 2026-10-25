export function unresolvedImageMessage(count: number): string {
  return count ? `${count} 个相对图像地址无法解析，请补充原网页地址后重新导入。` : '';
}
