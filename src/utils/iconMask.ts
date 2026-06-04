import type { CSSProperties } from 'react';

export function sidebarIconMaskStyle(src: string): CSSProperties {
	const url = src.startsWith('data:') ? src : resolveIconAssetUrl(src);
	const mask = `url("${url.replace(/"/g, '\\"')}")`;
	return {
		maskImage: mask,
		WebkitMaskImage: mask,
		maskSize: 'contain',
		maskRepeat: 'no-repeat',
		maskPosition: 'center'
	};
}

function resolveIconAssetUrl(src: string): string {
	if (!src || src.startsWith('data:') || src.startsWith('blob:')) return src;
	try {
		return new URL(src, window.location.href).href;
	} catch {
		return src;
	}
}
