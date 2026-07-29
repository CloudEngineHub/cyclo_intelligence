// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MissionBtEditor, { buildBtTreeFileUrl } from "./MissionBtEditor";

jest.mock("../../hooks/useBTNodeCatalog", () => ({
  useBTNodeCatalog: () => ({ catalog: [] }),
}));

jest.mock("react-redux", () => ({
  useSelector: (selector) => selector({ ros: { rosbridgeUrl: "ws://robot-host:7090" } }),
}));

jest.mock("react-hot-toast", () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));

jest.mock("../../features/btmanager/components/TreeListModal", () => ({
  __esModule: true,
  default: ({ isOpen, onSelect }) => isOpen ? (
    <button
      type="button"
      onClick={() => onSelect({ name: "template.xml", full_path: "/bt/trees/template.xml" })}
    >
      Select XML fixture
    </button>
  ) : null,
}));

const treeXml = (waitName) => [
  '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
  `  <BehaviorTree ID="MainTree"><Wait name="${waitName}" duration="1.0"/></BehaviorTree>`,
  "</root>",
].join("\n");

test("builds a data-server URL from ws and wss rosbridge URLs", () => {
  expect(buildBtTreeFileUrl("ws://robot-host:7090", "/bt/trees/example.xml"))
    .toBe("http://robot-host:7082/bt/trees/example.xml");
  expect(buildBtTreeFileUrl("wss://[2001:db8::1]:7090", "bt/trees/example.xml"))
    .toBe("http://[2001:db8::1]:7082/bt/trees/example.xml");
});

test("emits the loaded tree to the parent without waiting on a debounce", async () => {
  const onXmlChange = jest.fn();
  render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      xml={treeXml("StepA")}
      onXmlChange={onXmlChange}
    />,
  );
  // The tree is pushed up promptly (previously a re-render-starved debounce
  // could drop it entirely).
  await waitFor(() => expect(onXmlChange).toHaveBeenCalled());
  expect(onXmlChange.mock.calls.some(([xml]) => xml.includes("StepA"))).toBe(true);
});

test("emits to the new file path after a waypoint switch, not the old tree", async () => {
  const onXmlChange = jest.fn();
  const { rerender } = render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      xml={treeXml("StepA")}
      onXmlChange={onXmlChange}
    />,
  );
  await waitFor(() => (
    expect(onXmlChange.mock.calls.some(([xml]) => xml.includes("StepA"))).toBe(true)
  ));

  // Switch to another waypoint; the parent supplies that waypoint's XML.
  onXmlChange.mockClear();
  rerender(
    <MissionBtEditor
      title="B"
      filePath="locals/b.xml"
      xml={treeXml("StepB")}
      onXmlChange={onXmlChange}
    />,
  );
  // Any emission after the switch must be B's tree — never A's written to B.
  await waitFor(() => (
    expect(onXmlChange.mock.calls.some(([xml]) => xml.includes("StepB"))).toBe(true)
  ));
  expect(onXmlChange.mock.calls.some(([xml]) => xml.includes("StepA"))).toBe(false);
});

test("loads a BT Manager XML selection into the current waypoint tree", async () => {
  const onXmlChange = jest.fn();
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(treeXml("LoadedStep")),
  });

  render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      xml={treeXml("OriginalStep")}
      onXmlChange={onXmlChange}
    />,
  );
  await waitFor(() => expect(onXmlChange).toHaveBeenCalled());
  onXmlChange.mockClear();

  fireEvent.click(screen.getByRole("button", { name: "Load XML" }));
  fireEvent.click(screen.getByRole("button", { name: "Select XML fixture" }));

  await waitFor(() => expect(onXmlChange.mock.calls.some(([xml]) => (
    xml.includes("LoadedStep")
  ))).toBe(true));
  expect(global.fetch).toHaveBeenCalledWith("http://robot-host:7082/bt/trees/template.xml");
  global.fetch = originalFetch;
});
