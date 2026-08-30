/** Obviously synthetic. Never copy real people-graph files or owner contacts. */
export const DEMO = {
  person: {
    title: "Ada Demo",
    description: "Synthetic demo card — not a real person",
    email: "ada.demo@example.invalid",
  },
  twin: {
    title: "Ada Demo Twin",
    description: "Second synthetic card — email overlap only",
    email: "ada.demo@example.invalid",
    noteTitle: "Twin card note (demo)",
    noteBody: "Synthetic note on the twin card. Accept merge to move it — nothing merges before that.",
  },
  bea: {
    title: "Bea Demo",
    description: "Second synthetic card — reconnect demo only",
    email: "bea.demo@example.invalid",
    noteTitle: "Studio visit (demo)",
    noteBody: "Talked about the land-plot slip. Synthetic last-touch — not a real contact.",
  },
  commitments: {
    first: {
      what: "send the park slip",
      dueDate: "2026-09-06",
      sourceTitle: "Coffee at the park (demo)",
      sourceBody: "I promised to send the park slip by 2026-09-06. Synthetic — not a real contact.",
    },
    second: {
      what: "return the land-plot copy",
      sourceTitle: "Studio visit (demo)",
      sourceBody: "I said I'd return the land-plot copy. Synthetic — not a real contact.",
    },
  },
  park: {
    query: "Golden Gate Park, San Francisco",
    label: "Golden Gate Park, San Francisco, California, United States (demo)",
    latitude: 37.7694,
    longitude: -122.4862,
  },
} as const;
