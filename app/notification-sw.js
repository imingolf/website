self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?.json()||{};}catch(_error){data={body:event.data?.text()||"You have a new golf update."};}
  event.waitUntil(self.registration.showNotification(data.title||"I'm In Golf",{
    body:data.body||"Open I'm In Golf for the latest competition update.",
    icon:data.icon||"./icon-192.png",
    badge:data.badge||"./icon-192.png",
    tag:data.tag||"iig-competition-update",
    renotify:false,
    data:{url:data.url||"./"}
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"./",self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const windowClient of windows){
      if(windowClient.url.startsWith(self.location.origin)){
        await windowClient.focus();
        if("navigate" in windowClient)await windowClient.navigate(target);
        return;
      }
    }
    await clients.openWindow(target);
  })());
});
