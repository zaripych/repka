declare function functionName(): void;
declare const variable: string;
declare class SampleClass {
}
export interface ISample {
}
export namespace SampleNS { }
export namespace Sample {
	export { functionName };
	export { variable };
	export { SampleClass };
	export { ISample };
	export { SampleNS };
}

export {};
