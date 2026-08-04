import { createTheme, type MantineColorsTuple } from "@mantine/core";

export const projectBlue: MantineColorsTuple = [
  "#f3f5ff",
  "#e7ebff",
  "#d1d9ff",
  "#aebbff",
  "#8798f3",
  "#6277e5",
  "#4058d6",
  "#3448b8",
  "#2d3d98",
  "#26347d",
];

export const projectTheme = createTheme({
  primaryColor: "projectBlue",
  primaryShade: 6,
  colors: { projectBlue },
  defaultRadius: "md",
  fontFamily:
    "var(--font-geist-sans), Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif",
  headings: {
    fontFamily:
      "var(--font-geist-sans), Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif",
    fontWeight: "650",
  },
  focusRing: "auto",
  cursorType: "pointer",
  components: {
    Button: {
      defaultProps: { radius: "md" },
    },
    Modal: {
      defaultProps: { radius: "lg", centered: true, overlayProps: { blur: 2 } },
    },
    Drawer: {
      defaultProps: { overlayProps: { blur: 2 } },
    },
    Table: {
      defaultProps: { highlightOnHover: true, verticalSpacing: "sm" },
    },
  },
});
