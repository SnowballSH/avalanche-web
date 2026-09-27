(() => {
	let theme = "light";
	try {
		const stored = localStorage.getItem("fui-theme");
		theme =
			stored === "light" || stored === "dark"
				? stored
				: matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light";
	} catch {}
	document.documentElement.dataset.theme = theme;
})();
