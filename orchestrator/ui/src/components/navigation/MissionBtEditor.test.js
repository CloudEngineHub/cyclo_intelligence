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

import { render, waitFor } from "@testing-library/react";
import MissionBtEditor from "./MissionBtEditor";

jest.mock("../../hooks/useBTNodeCatalog", () => ({
  useBTNodeCatalog: () => ({ catalog: [] }),
}));

const treeXml = (waitName) => [
  '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
  `  <BehaviorTree ID="MainTree"><Wait name="${waitName}" duration="1.0"/></BehaviorTree>`,
  "</root>",
].join("\n");

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
