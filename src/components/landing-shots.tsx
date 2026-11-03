/** Pictures of the product on the landing, in HTML so they stay sharp. */

export function DraftShot() {
  return (
    <div
      className="ls-draft"
      role="img"
      aria-label="A new ticket beside the conversation that writes it"
    >
      <div className="ls-form" aria-hidden="true">
        <span className="ls-where mono">KEV</span>
        <h3>Archive a task</h3>
        <p>People can archive a task to clear their list without losing it.</p>
        <h4>Done when</h4>
        <ul>
          <li>A task can be archived from the list</li>
          <li>Archived tasks sit in a tab of their own</li>
          <li>Nothing is deleted</li>
        </ul>
        <span className="ls-create">Create ticket</span>
      </div>
      <div className="ls-talk" aria-hidden="true">
        <p className="lr-me">People should be able to archive a task</p>
        <p>
          KEV-10 touches the same list. Should archived tasks stay reachable?
        </p>
        <p className="lr-me">Yes, in a tab of their own</p>
        <p>Done. The action, the tab and nothing else.</p>
      </div>
    </div>
  );
}

const columns = [
  {
    name: "Todo",
    kind: "todo",
    cards: [
      { ref: "KEV-31", title: "Export tasks as CSV" },
      { ref: "KEV-34", title: "Filter by due date" },
    ],
  },
  {
    name: "In Progress",
    kind: "progress",
    cards: [{ ref: "KEV-28", title: "Archive a task", moved: true }],
  },
  {
    name: "In Review",
    kind: "progress",
    cards: [{ ref: "KEV-27", title: "Tasks need a priority", moved: true }],
  },
  {
    name: "Done",
    kind: "done",
    cards: [
      { ref: "KEV-22", title: "Comments on tasks", moved: true },
      { ref: "KEV-19", title: "Invite a teammate" },
    ],
  },
];

export function BoardShot() {
  return (
    <div
      className="ls-board"
      role="img"
      aria-label="A board whose tickets Yarrow moves from column to column"
    >
      {columns.map((column) => (
        <div className="ls-col" key={column.name} aria-hidden="true">
          <p className="ls-col-name">
            <span className={`ss-dot ${column.kind}`} />
            {column.name}
          </p>
          {column.cards.map((card) => (
            <div className="ls-card" key={card.ref}>
              <span className="mono">{card.ref}</span>
              <b>{card.title}</b>
              {card.moved && <em>Moved by Yarrow</em>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
