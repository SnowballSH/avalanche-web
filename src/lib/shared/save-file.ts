export const PGN_MEDIA_TYPE = "application/x-chess-pgn";

export const saveTextFile = (name: string, text: string, type = PGN_MEDIA_TYPE): void => {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.rel = "noopener";
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
};
