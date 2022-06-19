import { SomeInterface } from './extendable-module';

export function justFunction(input: SomeInterface): void {
	// do nothing
}

declare module './extendable-module' {
	interface SomeInterface {
		field2: typeof justFunction;
	}
}

declare module '@app/extendable-module' {
	interface SomeInterface {
		field3: typeof justFunction;
	}
}
