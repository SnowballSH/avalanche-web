import { error } from "@sveltejs/kit";

export const prerender = false;

export const load = () => {
	if (!__BOARD_HARNESS__) error(404, "Not found");
};
