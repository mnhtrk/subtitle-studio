export function splitFileNameAndExtension(fileName: string): { base: string; ext: string } {
	const trimmed = fileName.trim();
	const lastDot = trimmed.lastIndexOf('.');
	if (lastDot <= 0) {
		return { base: trimmed, ext: '' };
	}
	return {
		base: trimmed.slice(0, lastDot),
		ext: trimmed.slice(lastDot + 1)
	};
}

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeFileBaseInput(value: string, lockedExt: string): string {
	let v = value;
	if (lockedExt) {
		const suffix = `.${lockedExt}`;
		if (v.toLowerCase().endsWith(suffix.toLowerCase())) {
			v = v.slice(0, -suffix.length);
		}
	}
	return v.replace(INVALID_NAME_CHARS, '');
}

export function normalizeProjectRelativePath(path: string): string {
	return path.replace(/\\/g, '/').toLowerCase();
}

export function renamedFileMeta(
	fileName: string,
	relativePath: string,
	newBase: string
): { name: string; path: string } {
	const { ext } = splitFileNameAndExtension(fileName);
	const name = ext ? `${newBase}.${ext}` : newBase;
	const parts = relativePath.replace(/\\/g, '/').split('/');
	if (parts.length) parts[parts.length - 1] = name;
	return { name, path: parts.join('/') };
}

export function patchDiskFilesAfterRename(
	disk: { relative_path: string; name: string; is_dir?: boolean }[],
	files: { id: string; name: string; path: string; linked_file_id?: string | null }[],
	fileId: string,
	newBase: string
): { relative_path: string; name: string; is_dir?: boolean }[] {
	const targets = new Map<string, { name: string; path: string }>();
	const primary = files.find((f) => f.id === fileId);
	if (!primary) return disk;
	targets.set(primary.id, renamedFileMeta(primary.name, primary.path, newBase));
	if (primary.linked_file_id) {
		const partner = files.find((f) => f.id === primary.linked_file_id);
		if (partner) {
			targets.set(partner.id, renamedFileMeta(partner.name, partner.path, newBase));
		}
	}
	const oldKeys = new Set<string>();
	for (const id of targets.keys()) {
		const f = files.find((x) => x.id === id);
		if (f) oldKeys.add(normalizeProjectRelativePath(f.path));
	}
	const next = disk.filter((d) => !oldKeys.has(normalizeProjectRelativePath(d.relative_path)));
	const seen = new Set(next.map((d) => normalizeProjectRelativePath(d.relative_path)));
	for (const meta of targets.values()) {
		const key = normalizeProjectRelativePath(meta.path);
		if (!seen.has(key)) {
			next.push({ relative_path: meta.path, name: meta.name, is_dir: false });
			seen.add(key);
		}
	}
	return next;
}
