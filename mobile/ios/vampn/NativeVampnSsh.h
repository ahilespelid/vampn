#import <Foundation/Foundation.h>
#import <NMSSH/NMSSH.h>
#import <ReactCodegen/VampnSshSpec/VampnSshSpec.h>

NS_ASSUME_NONNULL_BEGIN

@interface NativeVampnSsh : NSObject <NativeVampnSshSpec, NMSSHSessionDelegate>
@end

NS_ASSUME_NONNULL_END
