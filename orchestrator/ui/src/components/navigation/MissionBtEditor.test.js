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
import MissionBtEditor, {
  isValidBtConnection,
} from "./MissionBtEditor";

jest.mock("../../hooks/useBTNodeCatalog", () => ({
  useBTNodeCatalog: () => ({ catalog: [] }),
}));

jest.mock("react-redux", () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector) => selector({
    ros: { rosbridgeUrl: "ws://robot-host:7090" },
    tasks: { robotType: "ffw_sg2" },
  }),
}));

jest.mock("react-hot-toast", () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));

const treeXml = (waitName) => [
  '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
  `  <BehaviorTree ID="MainTree"><Wait name="${waitName}" duration="1.0"/></BehaviorTree>`,
  "</root>",
].join("\n");

test("rejects connections that would make the BT cyclic or multi-parent", () => {
  const nodes = [
    { id: "root", type: "btControl" },
    { id: "branch", type: "btControl" },
    { id: "leaf", type: "btAction" },
  ];
  const edges = [
    { source: "root", target: "branch" },
    { source: "branch", target: "leaf" },
  ];

  expect(isValidBtConnection({ source: "root", target: "leaf" }, nodes, edges)).toBe(false);
  expect(isValidBtConnection({ source: "leaf", target: "root" }, nodes, edges)).toBe(false);
  expect(isValidBtConnection({ source: "branch", target: "root" }, nodes, edges)).toBe(false);
  expect(isValidBtConnection({ source: "root", target: "root" }, nodes, edges)).toBe(false);
  expect(isValidBtConnection(
    { source: "root", target: "leaf" },
    nodes,
    [{ source: "root", target: "branch" }],
  )).toBe(true);
});

test("hydrates a loaded tree without emitting an initial empty graph", async () => {
  const onXmlChange = jest.fn();
  render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      xml={treeXml("StepA")}
      onXmlChange={onXmlChange}
    />,
  );
  await screen.findByText("StepA");
  expect(onXmlChange).not.toHaveBeenCalled();
});

test("does not emit the previous graph while hydrating a new waypoint path", async () => {
  const onXmlChange = jest.fn();
  const { rerender } = render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      xml={treeXml("StepA")}
      onXmlChange={onXmlChange}
    />,
  );
  await screen.findByText("StepA");

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
  await screen.findByText("StepB");
  expect(onXmlChange).not.toHaveBeenCalled();
});

test("captures a new parameter edit immediately after undo", async () => {
  render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      xml={treeXml("StepA")}
      onXmlChange={jest.fn()}
    />,
  );
  fireEvent.click(await screen.findByText("StepA"));
  const undo = screen.getByTitle("Undo");
  fireEvent.change(screen.getByDisplayValue("1.0"), { target: { value: "2.0" } });
  await waitFor(() => expect(undo).toBeEnabled());
  fireEvent.click(undo);
  await waitFor(() => expect(undo).toBeDisabled());

  fireEvent.click(screen.getByText("StepA"));
  fireEvent.change(screen.getByDisplayValue("1.0"), { target: { value: "3.0" } });
  await waitFor(() => expect(undo).toBeEnabled());
});

test("loads a selected XML without changing the waypoint default", async () => {
  const onLoadXml = jest.fn().mockResolvedValue({
    path: "locals/b.xml",
    content: treeXml("LoadedStep"),
    exists: true,
  });
  const onFilePathChange = jest.fn();
  const onSetDefaultXml = jest.fn();
  render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      fileOptions={["locals/a.xml", "locals/b.xml"]}
      defaultFilePath="locals/a.xml"
      xml={treeXml("OriginalStep")}
      onXmlChange={jest.fn()}
      onLoadXml={onLoadXml}
      onFilePathChange={onFilePathChange}
      onSetDefaultXml={onSetDefaultXml}
    />,
  );
  await screen.findByText("OriginalStep");

  fireEvent.click(screen.getByRole("button", { name: "Load XML" }));
  expect(screen.getByRole("dialog", { name: "Local BT XML files" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /b\.xml/ }));
  fireEvent.click(screen.getByRole("button", { name: "Load Selected" }));
  await waitFor(() => expect(onLoadXml).toHaveBeenCalledWith("locals/b.xml"));
  expect(onFilePathChange).toHaveBeenCalledWith("locals/b.xml");
  expect(onSetDefaultXml).not.toHaveBeenCalled();
});

test("saves the latest graph to the current mission-local path", async () => {
  const onSaveXml = jest.fn().mockResolvedValue({
    path: "locals/a.xml",
    exists: true,
  });
  render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      xml={treeXml("StepA")}
      onXmlChange={jest.fn()}
      onSaveXml={onSaveXml}
    />,
  );
  fireEvent.click(await screen.findByText("StepA"));
  fireEvent.change(screen.getByDisplayValue("1.0"), { target: { value: "3.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save XML" }));

  await waitFor(() => expect(onSaveXml).toHaveBeenCalledWith(
    "locals/a.xml",
    expect.stringContaining('duration="3.5"'),
  ));
});

test("saves the latest graph as another XML in the same waypoint", async () => {
  const onSaveXmlAs = jest.fn().mockResolvedValue({
    path: "locals/spot_a/alternate.xml",
    exists: true,
  });
  const onFilePathChange = jest.fn();
  render(
    <MissionBtEditor
      title="A"
      filePath="locals/a.xml"
      fileOptions={["locals/a.xml"]}
      defaultFilePath="locals/a.xml"
      xml={treeXml("StepA")}
      onXmlChange={jest.fn()}
      onSaveXmlAs={onSaveXmlAs}
      onFilePathChange={onFilePathChange}
    />,
  );
  fireEvent.click(await screen.findByText("StepA"));
  fireEvent.change(screen.getByDisplayValue("1.0"), { target: { value: "4.0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save XML as" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New BT XML name" }), {
    target: { value: "alternate" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save As" }));

  await waitFor(() => expect(onSaveXmlAs).toHaveBeenCalledWith(
    "locals/a.xml",
    "alternate",
    expect.stringContaining('duration="4.0"'),
  ));
  expect(onFilePathChange).toHaveBeenCalledWith("locals/spot_a/alternate.xml");
});

test("changes the runtime default only through Set Default", async () => {
  const onSetDefaultXml = jest.fn().mockResolvedValue(undefined);
  render(
    <MissionBtEditor
      title="A"
      filePath="locals/b.xml"
      fileOptions={["locals/a.xml", "locals/b.xml"]}
      defaultFilePath="locals/a.xml"
      xml={treeXml("StepB")}
      onXmlChange={jest.fn()}
      onSetDefaultXml={onSetDefaultXml}
    />,
  );
  await screen.findByText("StepB");
  fireEvent.click(screen.getByRole("button", { name: "Set default BT" }));
  await waitFor(() => expect(onSetDefaultXml).toHaveBeenCalledWith("locals/b.xml"));
});
