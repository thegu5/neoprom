import { defineConfig } from "tsdown";

export default defineConfig({
	outputOptions: {
		banner: `/* @ts-self-types="./index.d.ts" */`,
	},
	fixedExtension: false,
});
