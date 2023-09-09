export type TodoEntry = {
  entryId: string;
  timestamp: number;
  text: string;
  done: boolean;
};

export type TodoEntryUpdateShape = Pick<TodoEntry, 'entryId'> &
  Partial<Omit<TodoEntry, 'entryId'>>;
