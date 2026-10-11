import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "admin-night-shift/index.html"), "utf8");

function functionSource(begin, next) {
  const start = source.indexOf(begin);
  const end = source.indexOf(next, start + begin.length);
  assert.ok(start !== -1 && end > start, `Cannot find ${begin}`);
  return source.slice(start, end);
}

const calendarSource = functionSource(
  "  function renderCalendar() {",
  "\n  function createCalendarChip(item) {"
);
const monthSource = functionSource(
  "  async function loadMonth() {",
  "\n  async function renderAll() {"
);

const toYMD = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classes = new Set();
    this.className = "";
    this.classList = {
      add: (...classes) => classes.forEach(x => this.classes.add(x)),
      remove: (...classes) => classes.forEach(x => this.classes.delete(x))
    };
    this.listeners = {};
    this.textContent = "";
  }

  appendChild(node) {
    if (node.tag === "fragment") this.children.push(...node.children);
    else this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach(node => this.appendChild(node));
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }
}

function calendarHarness(month, entries = []) {
  const nodes = new Map();
  const $ = key => {
    if (!nodes.has(key)) nodes.set(key, new FakeNode("div"));
    return nodes.get(key);
  };
  const typeById = id => ({
    group_name: id === 1 ? "值班" : "门诊",
    code: id === 1 ? "duty" : "mobile_clinic"
  });
  const context = {
    monthCursor: new Date(month),
    assignments: entries,
    filterGroup: "all",
    filterCode: "",
    holidayCache: new Map([[2026, {
      "2026-10-01": {type:"holiday",name:"国庆节"}
    }]]),
    toYMD,
    sortAssignments: items => [...items],
    typeById,
    document: {
      createElement: tag => new FakeNode(tag),
      createDocumentFragment: () => new FakeNode("fragment")
    },
    createCalendarChip: item => {
      const chip = new FakeNode("chip");
      chip.textContent = item.staff_id;
      return chip;
    },
    openDetail: () => {},
    $
  };
  context.filteredAssignments = items => items.filter(item =>
    context.filterGroup === "all" ||
    (context.filterGroup === "duty" && item.duty_type_id === 1) ||
    (context.filterGroup === "clinic" && item.duty_type_id === 5)
  );
  runInNewContext(calendarSource, context);
  return { context, nodes };
}

function checkNoDuplicateDays(cells) {
  const dates = cells.map(cell => cell.dataset.date);
  assert.equal(new Set(dates).size, dates.length, "duplicate date card detected");
  assert.equal(dates.length % 7, 0, "calendar grid must contain whole weeks");
  return dates;
}

test("October 2026 has 35 unique calendar cells and 31 in-month dates", () => {
  const {context, nodes} = calendarHarness("2026-10-01");
  context.renderCalendar();
  const cells = nodes.get("grid").children;
  const dates = checkNoDuplicateDays(cells);
  assert.equal(cells.length, 35);
  assert.equal(dates.filter(x => x.startsWith("2026-10-")).length, 31);
  assert.equal(dates[0], "2026-09-27");
  assert.equal(dates.at(-1), "2026-10-31");
  assert.ok(cells.find(x => x.dataset.date === "2026-10-01").classes.has("holiday-day"));

  context.renderCalendar();
  assert.equal(nodes.get("grid").children.length, 35, "re-render must replace, not append");
  checkNoDuplicateDays(nodes.get("grid").children);
});

test("six-week month and repeated filter changes never append duplicate dates", () => {
  const entries = [
    {work_date:"2026-10-08",duty_type_id:1,staff_id:"doctor-A"},
    {work_date:"2026-10-08",duty_type_id:5,staff_id:"doctor-B"}
  ];
  const {context, nodes} = calendarHarness("2026-10-01", entries);
  context.renderCalendar();
  const day = nodes.get("grid").children.find(x => x.dataset.date === "2026-10-08");
  assert.ok(day.children.some(x => x.textContent === "🏥 门诊 1项"));
  assert.ok(day.children.some(x => x.textContent === "doctor-A"));

  context.filterGroup = "clinic";
  context.renderCalendar();
  assert.equal(nodes.get("grid").children.length, 35);
  const clinic = nodes.get("grid").children.find(x => x.dataset.date === "2026-10-08");
  assert.ok(clinic.children.some(x => x.textContent === "doctor-B"));
  assert.ok(!clinic.children.some(x => x.textContent === "doctor-A"));

  context.monthCursor = new Date(2026, 7, 1);
  context.renderCalendar();
  const dates = checkNoDuplicateDays(nodes.get("grid").children);
  assert.equal(dates.length, 42);
  assert.equal(dates.filter(x => x.startsWith("2026-08-")).length, 31);
  context.monthCursor = new Date(2026, 9, 1);
  context.renderCalendar();
  checkNoDuplicateDays(nodes.get("grid").children);
  assert.equal(nodes.get("grid").children.length, 35);
});

test("stale month responses never overwrite the latest schedule", async () => {
  const pending = [];
  const rendered = [];
  const context = {
    monthCursor: new Date(2026, 9, 1),
    monthLoadVersion: 0,
    assignments: [],
    toYMD,
    loadHolidayYear: async () => ({}),
    renderAll: async () => rendered.push(context.assignments[0]?.id),
    db: {
      from: () => {
        const request = {
          select() { return this; },
          gte() { return this; },
          lte() { return this; },
          order() {
            return new Promise(resolve => pending.push(resolve));
          }
        };
        return request;
      }
    },
    console: {warn() {}}
  };
  runInNewContext(monthSource, context);
  const first = context.loadMonth();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1);

  context.monthCursor = new Date(2026, 10, 1);
  const second = context.loadMonth();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);

  pending[1]({data:[{id:"November"}],error:null});
  await second;
  pending[0]({data:[{id:"October-stale"}],error:null});
  await first;

  assert.equal(context.assignments[0].id, "November");
  assert.deepEqual(rendered, ["November"]);
});

test("calendar renderer is synchronous and commits once", () => {
  assert.ok(!calendarSource.includes("await "), "per-date awaits must not return");
  assert.equal(
    (calendarSource.match(/grid\.replaceChildren\(/g) || []).length,
    1
  );
  assert.ok(calendarSource.includes("document.createDocumentFragment()"));
});
