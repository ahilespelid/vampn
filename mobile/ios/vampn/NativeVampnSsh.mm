#import "NativeVampnSsh.h"

#import <NMSSH/NMSSH.h>
#import <ReactCodegen/VampnSshSpec/VampnSshSpec.h>

@implementation NativeVampnSsh

RCT_EXPORT_MODULE(NativeVampnSsh)

@synthesize bridge = _bridge;

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.vampn.ssh", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeVampnSshSpecJSI>(params);
}

- (BOOL)session:(NMSSHSession *)session shouldConnectToHostWithFingerprint:(NSString *)fingerprint
{
  (void)session;
  (void)fingerprint;
  return YES;
}

- (void)exec:(NSString *)requestJson
    resolve:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject
{
  NSData *data = [requestJson dataUsingEncoding:NSUTF8StringEncoding];
  if (data == nil) {
    reject(@"SSH_ERROR", @"Bad request", nil);
    return;
  }

  NSError *parseError = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:&parseError];
  if (parseError != nil || ![parsed isKindOfClass:[NSDictionary class]]) {
    reject(@"SSH_ERROR", @"Bad request", parseError);
    return;
  }

  NSDictionary *request = (NSDictionary *)parsed;
  NSString *host = request[@"host"] ?: @"";
  NSInteger port = [request[@"port"] integerValue];
  if (port <= 0) {
    port = 22;
  }
  NSString *username = request[@"username"] ?: @"";
  NSString *password = request[@"password"] ?: @"";
  NSString *privateKey = request[@"privateKey"] ?: @"";
  NSString *passphrase = request[@"passphrase"] ?: @"";
  NSArray *commands = request[@"commands"];

  if (host.length == 0 || username.length == 0) {
    reject(@"SSH_ERROR", @"Host and username are required", nil);
    return;
  }
  if (![commands isKindOfClass:[NSArray class]] || commands.count == 0) {
    reject(@"SSH_ERROR", @"No commands", nil);
    return;
  }

  NMSSHSession *session = [[NMSSHSession alloc] initWithHost:host port:port andUsername:username];
  session.delegate = self;
  if (![session connectWithTimeout:@15]) {
    NSString *message = session.lastError.localizedDescription ?: @"Could not connect";
    NSError *error = session.lastError;
    [session disconnect];
    reject(@"SSH_ERROR", message, error);
    return;
  }

  BOOL authed = NO;
  if (privateKey.length > 0) {
    NSString *pass = passphrase.length > 0 ? passphrase : nil;
    authed = [session authenticateByInMemoryPublicKey:nil privateKey:privateKey andPassword:pass];
  } else {
    authed = [session authenticateByPassword:password];
  }
  if (!authed) {
    NSString *message = session.lastError.localizedDescription ?: @"Authentication failed";
    NSError *error = session.lastError;
    [session disconnect];
    reject(@"SSH_AUTH", message, error);
    return;
  }

  NSMutableString *output = [NSMutableString string];
  BOOL ok = YES;
  for (id item in commands) {
    if (![item isKindOfClass:[NSString class]]) {
      continue;
    }
    NSString *command = (NSString *)item;
    NSError *error = nil;
    NSString *response = [session.channel execute:command error:&error timeout:@60];
    [output appendFormat:@"$ %@\n%@\n", command, response ?: @""];
    if (error != nil) {
      ok = NO;
      if (error.localizedDescription.length > 0) {
        [output appendFormat:@"%@\n", error.localizedDescription];
      }
    }
  }
  [session disconnect];

  if (output.length > 4000) {
    NSString *clipped = [[output substringToIndex:4000] stringByAppendingString:@"\n…"];
    output = [clipped mutableCopy];
  }

  NSDictionary *result = @{@"ok" : @(ok), @"output" : output};
  NSData *resultData = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
  NSString *resultJson = [[NSString alloc] initWithData:resultData encoding:NSUTF8StringEncoding];
  resolve(resultJson ?: @"{\"ok\":false,\"output\":\"\"}");
}

@end
