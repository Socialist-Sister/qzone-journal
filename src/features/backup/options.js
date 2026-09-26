import { ChatsCircle, Heart, NotePencil } from "@phosphor-icons/react";

const backupOptions = [
  { id: "posts", label: "说说正文与媒体", description: "正文、发布时间和可读取的原图与原生视频", icon: NotePencil },
  { id: "comments", label: "评论与回复", description: "保存页面当前可见的评论与回复", icon: ChatsCircle },
  { id: "likes", label: "点赞记录", description: "说说备份后补充，可能较慢或不完整", icon: Heart },
];

export { backupOptions };
