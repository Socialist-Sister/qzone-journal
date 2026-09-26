import { ChatsCircle, Images, NotePencil } from "@phosphor-icons/react";

const archiveFilters = [
  { id: "all", label: "全部" },
  { id: "post", label: "说说" },
  { id: "journal", label: "日志" },
  { id: "album", label: "相册" },
];

const entryTypeMeta = {
  post: { label: "说说", icon: NotePencil },
  journal: { label: "日志", icon: ChatsCircle },
  album: { label: "相册", icon: Images },
};

export { archiveFilters, entryTypeMeta };
