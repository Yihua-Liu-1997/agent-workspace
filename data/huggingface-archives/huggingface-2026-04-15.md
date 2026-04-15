🤗 **Hugging Face 今日热门论文**
📅 2026年4月15日星期三

---

🥇 **QuanBench+: A Unified Multi-Framework Benchmark for LLM-Based Quantum Code Generation**
   👍 112
   👥 Ali Slim, Haydar Hamieh, Jawad Kotaich 等
   📄 [arXiv:2604.08570](https://arxiv.org/abs/2604.08570) | 🤗 [HF Paper](https://huggingface.co/papers/2604.08570) | 💻 [GitHub](https://github.com/JawadKotaichh/quanbench-plus)

   💭 最近读到了一篇挺有意思的论文 QuanBench+，觉得值得跟你分享一下。这篇文章最核心的贡献是构建了一个跨越多框架的量子代码生成基准测试。以前大家评估大模型写量子代码时，往往只用单一的框架，这就很难判断模型到底是真正理解了量子逻辑，还是仅仅死记硬背了特定框架的 API。QuanBench+ 巧妙地解决了这个问题，它统一了 Qiskit、PennyLane 和 Cirq 三大主流框架，并设计了 42 个对齐的测试任务，结合可执行的功能测试来更纯粹地检验大模型的“量子推理”能力。这项研究对于未来的 AI 辅助量子编程意义重大，毕竟量子计算的开发门槛一直很高，如果能依赖大模型准确生成、转换不同框架下的量子算法代码，绝对能大大降低科研人员和开发者应用量子计算的门槛。如果你最近也在关注大模型或者量子计算的交叉领域，这篇论文真的非常推荐一读！

🥈 **ClawGUI: A Unified Framework for Training, Evaluating, and Deploying GUI Agents**
   👍 107
   👥 Fei Tang, Zhiqiong Lu, Boxuan Zhang 等
   📄 [arXiv:2604.11784](https://arxiv.org/abs/2604.11784) | 🤗 [HF Paper](https://huggingface.co/papers/2604.11784) | 💻 [GitHub](https://github.com/ZJU-REAL/ClawGUI)

   💭 最近读到一篇挺有意思的论文《ClawGUI》，感觉你一定会感兴趣。这篇文章主要解决的是目前GUI智能体研发中的一个核心痛点：大家的瓶颈往往不是模型本身不够聪明，而是缺一套统一的基础设施。为此，作者团队提出了一个把训练、评估和部署全部打通的全栈框架，刚好弥补了目前在线强化学习环境不稳定、各家评估标准各搞一套的缺陷。最酷的是它的实际应用价值，相比于只能调用API的传统智能体，它可以直接像人类一样通过视觉界面去点击、滑动来操作任意软件。这意味着无论是那些毫无API支持的小众长尾应用，还是日常的电脑手机自动化操作，它都能轻松拿捏。如果你最近在做智能体或者自动化相关的研究，这篇论文绝对值得花时间看一看！

🥉 **The Past Is Not Past: Memory-Enhanced Dynamic Reward Shaping**
   👍 82
   👥 Yang Liu, Enxi Wang, Yufei Gao 等
   📄 [arXiv:2604.11297](https://arxiv.org/abs/2604.11297) | 🤗 [HF Paper](https://huggingface.co/papers/2604.11297) | 💻 [GitHub](https://github.com/Linxi000/MEDS)

   💭 最近读到了一篇非常有意思的论文，感觉特别值得跟你分享一下。这篇文章主要解决了大语言模型在强化学习中一个挺让人头疼的问题：模型在训练时经常会陷入死胡同，一遍又一遍地生成完全相同的错误答案，而传统的增加随机性的方法对这种“历史重演”根本束手无策。为了打破这个僵局，作者团队提出了一个叫MEDS的新框架。它的核心思路特别巧妙，就是给奖励机制加上了一个“历史记忆”，通过记住过去的错误行为来动态调整奖励，从而专门惩罚那些反复出现的失败模式。我觉得这个思路非常实用，在复杂逻辑推理、长文本生成或是多轮对话等需要模型不断试错和深度探索的场景下应用潜力巨大，绝对能帮我们训练出更聪明、更不容易“钻牛角尖”的大模型，强烈推荐你读一读！

4️⃣ **Attention Sink in Transformers: A Survey on Utilization, Interpretation, and Mitigation**
   👍 58
   👥 Zunhai Su, Hengyuan Zhang, Wei Wu 等
   📄 [arXiv:2604.10098](https://arxiv.org/abs/2604.10098) | 🤗 [HF Paper](https://huggingface.co/papers/2604.10098) | 💻 [GitHub](https://github.com/ZunhaiSu/Awesome-Attention-Sink)

   💭 嘿，如果你最近在折腾大模型，我强烈推荐你读读这篇关于Transformer中“注意力汇聚”现象的综述。文章把那个让很多研究者头疼的问题——模型总喜欢把大量注意力分配给那些毫无信息量的特定token——讲得非常透彻。它的核心贡献是系统性地梳理了目前学术界该如何去解释、缓解甚至是利用这种现象。对于做模型底层优化或关注AI安全的朋友来说，这篇论文特别有参考价值，因为搞定这个问题不仅能改善大模型的训练和推理效率，还能有效缓解让人抓狂的模型“幻觉”问题，帮我们构建更稳定、可解释性更强的AI系统。绝对是一篇值得花时间看看的好文！

5️⃣ **Uni-ViGU: Towards Unified Video Generation and Understanding via A Diffusion-Based Video Generator**
   👍 39
   👥 Luozheng Qin, Jia Gong, Qian Qiao 等
   📄 [arXiv:2604.08121](https://arxiv.org/abs/2604.08121) | 🤗 [HF Paper](https://huggingface.co/papers/2604.08121) | 💻 [GitHub](https://github.com/Fr0zenCrane/Uni-ViGU)

   💭 最近读到一篇特别有意思的论文想推荐给你，叫 Uni-ViGU。这篇文章提出了一个非常巧妙的“反向”思路来解决多模态模型中视觉生成和理解算力严重失衡的问题。以前的常规操作都是在以理解为主的大模型上硬加上生成能力，但这篇论文的作者们反其道而行之，直接把基于扩散模型的视频生成器作为基础底座，然后再往外扩展出视频理解能力。这种核心范式的转换不仅缓解了计算资源分配的痛点，还给未来那些需要同时“看懂”并“创作”视频的复杂场景打下了很好的基础，比如智能视频剪辑、高质量的文生视频以及影视内容辅助生成等领域都大有可为。如果你最近在关注多模态架构的演进，这篇论文的视角绝对会给你带来不少启发，非常值得一读！

---
_数据来源: [Hugging Face Daily Papers](https://huggingface.co/papers) | 评论由 AI 生成_