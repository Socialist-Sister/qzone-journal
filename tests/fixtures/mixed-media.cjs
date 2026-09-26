// Synthetic QQ payload: videos occupy positions 4, 6 and 7, matching the reported layout.
function mixedMediaPayload({ legacy = false } = {}) {
  const videoSlots = new Set([4, 6, 7]);
  const videos = [7, 4, 6].map((slot) => ({ video_id: `video-${slot}`, url3: `https://photovideo.photo.qq.com/${slot}.mp4`, pic_url: `https://qpic.cn/cover-${slot}.jpg`, url1: `https://qpic.cn/thumb-${slot}.jpg` }));
  const pic = Array.from({ length: 9 }, (_, index) => {
    const slot = index + 1;
    if (!videoSlots.has(slot)) return { url1: `https://qpic.cn/photo-${slot}.jpg` };
    const video = videos.find((item) => item.video_id === `video-${slot}`);
    return legacy ? { url1: video.url1, video_info: { video_id: video.video_id, pic_url: video.pic_url } } : { url1: video.url1 };
  });
  return { code: 0, msglist: [{ tid: "mixed-order", uin: "12345678", created_time: 1700000000, content: "图文原始顺序", pic, video: videos }] };
}
module.exports = { mixedMediaPayload };
