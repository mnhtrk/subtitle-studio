/// <reference types="vite/client" />

declare module 'nspell' {
	type Dictionary = { aff: string; dic: string };
	function nspell(dictionary: Dictionary): {
		correct(word: string): boolean;
		suggest(word: string): string[];
	};
	export default nspell;
}

declare module '*.aff?url' {
	const url: string;
	export default url;
}

declare module '*.dic?url' {
	const url: string;
	export default url;
}
